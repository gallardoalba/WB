package org.wanderbibliothek.app.data

import android.content.Context
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONObject

private val Context.wanderDataStore by preferencesDataStore(name = "wanderbibliothek")

const val DEFAULT_SERVER_URL = "https://wanderbibliothek.org"

enum class ThemePreference(val storageValue: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark");

    companion object {
        fun fromStorage(value: String?): ThemePreference =
            entries.firstOrNull { it.storageValue == value } ?: SYSTEM
    }
}

data class AppSettings(
    val serverUrl: String,
    /** `system`, `de` o `es`. */
    val language: String,
    val theme: ThemePreference,
)

/**
 * Identidad de cifrado de este dispositivo.
 *
 * La clave privada se guarda en el almacén privado de la app (nadie más puede
 * leerla), igual que la web la guarda en IndexedDB: el servidor solo conoce la
 * pública.
 */
data class IdentityRecord(
    val keyId: String,
    val publicJwk: JSONObject,
    val privateKeyPkcs8: ByteArray,
) {
    override fun equals(other: Any?): Boolean =
        other is IdentityRecord && other.keyId == keyId

    override fun hashCode(): Int = keyId.hashCode()
}

class Prefs(context: Context) {
    private val dataStore = context.applicationContext.wanderDataStore

    val settings: Flow<AppSettings> = dataStore.data.map { preferences ->
        AppSettings(
            serverUrl = preferences[SERVER_URL] ?: DEFAULT_SERVER_URL,
            language = preferences[LANGUAGE] ?: "system",
            theme = ThemePreference.fromStorage(preferences[THEME]),
        )
    }

    suspend fun settingsOnce(): AppSettings = settings.first()

    suspend fun serverUrl(): String = dataStore.data.first()[SERVER_URL] ?: DEFAULT_SERVER_URL

    suspend fun setServerUrl(value: String) {
        dataStore.edit { it[SERVER_URL] = value }
    }

    suspend fun setLanguage(value: String) {
        dataStore.edit { it[LANGUAGE] = value }
    }

    suspend fun language(): String = dataStore.data.first()[LANGUAGE] ?: "system"

    suspend fun setTheme(value: ThemePreference) {
        dataStore.edit { it[THEME] = value.storageValue }
    }

    /* ---------------------------- sesión (cookies) --------------------------- */

    /**
     * Sesión en memoria para cuando el Keystore no deja cifrar: la app sigue
     * funcionando en esta ejecución, pero no se escribe nada en disco.
     */
    @Volatile
    private var sessionFallback: Pair<String, String>? = null

    /**
     * Tarros de cookies **por host**.
     *
     * La sesión pertenece a un servidor concreto: guardar un único tarro y
     * reenviarlo tras cambiar de dirección mandaría el token a otro sitio. Se
     * guarda como `{"<host>": "<cabecera>"}` cifrado.
     */
    private suspend fun cookieJars(): MutableMap<String, String> {
        val raw = dataStore.data.first()[COOKIES]?.let(SecretBox::open)
            ?: return mutableMapOf()
        val parsed = runCatching { JSONObject(raw) }.getOrNull()
        if (parsed == null) {
            // Formato anterior a la v0.1.1: una sola cabecera, del servidor
            // que estuviera configurado entonces.
            val host = hostOf(dataStore.data.first()[SERVER_URL] ?: DEFAULT_SERVER_URL)
            return if (host != null) mutableMapOf(host to raw) else mutableMapOf()
        }
        return mutableMapOf<String, String>().apply {
            parsed.keys().forEach { host ->
                parsed.optString(host).takeIf { it.isNotBlank() }?.let { put(host, it) }
            }
        }
    }

    /** Cookies de ese servidor, o `null` si no hay sesión guardada. */
    suspend fun cookieHeader(host: String): String? =
        cookieJars()[host] ?: sessionFallback?.takeIf { it.first == host }?.second

    /** Aplica las cabeceras `Set-Cookie` de una respuesta del servidor [host]. */
    suspend fun storeCookies(host: String, setCookies: List<String>) {
        if (setCookies.isEmpty()) return
        val jars = cookieJars()
        val current = parseCookies(jars[host].orEmpty()).toMutableMap()
        setCookies.forEach { raw ->
            val parts = raw.split(';')
            val pair = parts.firstOrNull()?.trim().orEmpty()
            val index = pair.indexOf('=')
            if (index <= 0) return@forEach
            val name = pair.substring(0, index)
            val value = pair.substring(index + 1)
            val expired = parts.any { it.trim().startsWith("Max-Age=0", ignoreCase = true) }
            if (expired || value.isEmpty()) current.remove(name) else current[name] = value
        }
        val header = current.entries.joinToString("; ") { "${it.key}=${it.value}" }
        if (header.isEmpty()) jars.remove(host) else jars[host] = header

        val payload = JSONObject().apply {
            jars.forEach { (jarHost, jar) -> put(jarHost, jar) }
        }.toString()
        val sealed = SecretBox.sealOrNull(payload)
        if (sealed == null) {
            // Sin Keystore la sesión no se persiste, pero sigue viva en memoria.
            sessionFallback = host to header
            return
        }
        dataStore.edit { preferences ->
            if (jars.isEmpty()) {
                preferences.remove(COOKIES)
            } else {
                preferences[COOKIES] = sealed
            }
        }
    }

    suspend fun clearSession() {
        sessionFallback = null
        dataStore.edit { it.remove(COOKIES) }
    }

    private fun parseCookies(header: String): Map<String, String> =
        header.split(';')
            .mapNotNull { part ->
                val trimmed = part.trim()
                val index = trimmed.indexOf('=')
                if (index <= 0) {
                    null
                } else {
                    trimmed.substring(0, index) to trimmed.substring(index + 1)
                }
            }
            .toMap()

    private fun hostOf(url: String): String? =
        runCatching { java.net.URL(url).host.ifBlank { null } }.getOrNull()

    /* ------------------------------ identidad E2E ---------------------------- */

    /**
     * Identidad E2E de una cuenta. Es **por cuenta**: dos personas que usen el
     * mismo móvil no comparten clave privada ni quedan vinculadas por la misma
     * clave pública.
     *
     * La identidad única de la v0.1 no se adopta aquí: no dice de qué cuenta
     * era y entregarla a la primera que entre podría publicarla en otra. La
     * reclama [WanderRepository.ensureIdentity] solo si el servidor ya tiene esa
     * clave en la ranura del móvil.
     */
    suspend fun identity(userId: String): IdentityRecord? {
        val preferences = dataStore.data.first()
        return preferences[identityKey(userId)]?.let(SecretBox::open)?.let(::decodeIdentity)
    }

    /** Identidad sin dueño de la v0.1, si esta instalación todavía la tiene. */
    suspend fun legacyIdentity(): IdentityRecord? {
        val preferences = dataStore.data.first()
        val keyId = preferences[E2E_KEY_ID] ?: return null
        val privateKey = preferences[E2E_PRIVATE_KEY] ?: return null
        val publicJwk = preferences[E2E_PUBLIC_JWK] ?: return null
        return runCatching {
            IdentityRecord(
                keyId = keyId,
                publicJwk = JSONObject(publicJwk),
                privateKeyPkcs8 = Base64.decode(privateKey, Base64.NO_WRAP),
            )
        }.getOrNull()
    }

    /** Borra la identidad antigua una vez reclamada o descartada. */
    suspend fun clearLegacyIdentity() {
        dataStore.edit { it.remove(E2E_KEY_ID); it.remove(E2E_PRIVATE_KEY); it.remove(E2E_PUBLIC_JWK) }
    }

    suspend fun saveIdentity(
        userId: String,
        keyId: String,
        publicJwk: JSONObject,
        privateKeyPkcs8: ByteArray,
    ) {
        val payload = JSONObject()
            .put("keyId", keyId)
            .put("jwk", publicJwk)
            .put("privateKey", Base64.encodeToString(privateKeyPkcs8, Base64.NO_WRAP))
            .toString()
        dataStore.edit { preferences ->
            preferences[identityKey(userId)] = SecretBox.seal(payload)
        }
    }

    suspend fun clearIdentity(userId: String) {
        dataStore.edit { preferences -> preferences.remove(identityKey(userId)) }
    }

    /** La identidad única de antes de la v0.2 pasa a la primera cuenta que la use. */
    private fun decodeIdentity(value: String): IdentityRecord? = runCatching {
        val json = JSONObject(value)
        IdentityRecord(
            keyId = json.getString("keyId"),
            publicJwk = json.getJSONObject("jwk"),
            privateKeyPkcs8 = Base64.decode(json.getString("privateKey"), Base64.NO_WRAP),
        )
    }.getOrNull()

    private fun identityKey(userId: String) = stringPreferencesKey("identity_$userId")

    private companion object {
        val SERVER_URL = stringPreferencesKey("server_url")
        val LANGUAGE = stringPreferencesKey("language")
        val THEME = stringPreferencesKey("theme")
        val COOKIES = stringPreferencesKey("cookies")
        val E2E_KEY_ID = stringPreferencesKey("e2e_key_id")
        val E2E_PRIVATE_KEY = stringPreferencesKey("e2e_private_key")
        val E2E_PUBLIC_JWK = stringPreferencesKey("e2e_public_jwk")
    }
}
