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

    suspend fun cookies(): Map<String, String> {
        val raw = dataStore.data.first()[COOKIES]?.let(SecretBox::open) ?: return emptyMap()
        return raw.split(';')
            .mapNotNull { part ->
                val trimmed = part.trim()
                val index = trimmed.indexOf('=')
                if (index <= 0) null else trimmed.substring(0, index) to trimmed.substring(index + 1)
            }
            .toMap()
    }

    suspend fun cookieHeader(): String? {
        val all = cookies()
        if (all.isEmpty()) return null
        return all.entries.joinToString("; ") { "${it.key}=${it.value}" }
    }

    /** Aplica las cabeceras `Set-Cookie` de una respuesta. */
    suspend fun storeCookies(setCookies: List<String>) {
        if (setCookies.isEmpty()) return
        val current = cookies().toMutableMap()
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
        dataStore.edit { preferences ->
            if (current.isEmpty()) {
                preferences.remove(COOKIES)
            } else {
                preferences[COOKIES] =
                    SecretBox.seal(current.entries.joinToString("; ") { "${it.key}=${it.value}" })
            }
        }
    }

    suspend fun clearSession() {
        dataStore.edit { it.remove(COOKIES) }
    }

    /* ------------------------------ identidad E2E ---------------------------- */

    /**
     * Identidad E2E de una cuenta. Es **por cuenta**: dos personas que usen el
     * mismo móvil no comparten clave privada ni quedan vinculadas por la misma
     * clave pública. Se migra la identidad única de versiones anteriores.
     */
    suspend fun identity(userId: String): IdentityRecord? {
        val preferences = dataStore.data.first()
        preferences[identityKey(userId)]?.let(SecretBox::open)?.let { stored ->
            decodeIdentity(stored)?.let { return it }
        }
        return migrateLegacyIdentity(userId)
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
    private suspend fun migrateLegacyIdentity(userId: String): IdentityRecord? {
        val preferences = dataStore.data.first()
        val keyId = preferences[E2E_KEY_ID] ?: return null
        val privateKey = preferences[E2E_PRIVATE_KEY] ?: return null
        val publicJwk = preferences[E2E_PUBLIC_JWK] ?: return null
        val record = runCatching {
            IdentityRecord(
                keyId = keyId,
                publicJwk = JSONObject(publicJwk),
                privateKeyPkcs8 = Base64.decode(privateKey, Base64.NO_WRAP),
            )
        }.getOrNull() ?: return null
        saveIdentity(userId, record.keyId, record.publicJwk, record.privateKeyPkcs8)
        dataStore.edit { it.remove(E2E_KEY_ID); it.remove(E2E_PRIVATE_KEY); it.remove(E2E_PUBLIC_JWK) }
        return record
    }

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
