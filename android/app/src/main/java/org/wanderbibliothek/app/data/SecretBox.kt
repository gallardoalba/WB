package org.wanderbibliothek.app.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cifra los secretos de la app (cookie de sesión e identidad E2E) con una clave
 * AES-256 que vive en el Android Keystore y nunca sale del dispositivo.
 *
 * Los valores se guardan como `enc1:<base64(iv || ciphertext)>`. Un valor sin
 * ese prefijo se devuelve tal cual: así una instalación anterior sigue
 * funcionando y se migra la próxima vez que se escribe.
 */
object SecretBox {
    /** El Keystore no está disponible: no se puede guardar nada sensible. */
    class Unavailable : Exception("El almacén de claves del sistema no está disponible.")

    private const val ALIAS = "wanderbibliothek-secrets"
    private const val PREFIX = "enc1:"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    /** Cifra un texto. **Nunca** devuelve el texto en claro. */
    fun seal(plain: String): String = try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        val data = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val merged = ByteArray(iv.size + data.size)
        System.arraycopy(iv, 0, merged, 0, iv.size)
        System.arraycopy(data, 0, merged, iv.size, data.size)
        PREFIX + Base64.encodeToString(merged, Base64.NO_WRAP)
    } catch (error: Exception) {
        // Antes se devolvía el texto tal cual: la cookie y la clave privada
        // acababan escritas en claro sin que nadie lo supiera. Ahora se avisa.
        throw Unavailable().apply { initCause(error) }
    }

    /**
     * Igual que [seal] pero devuelve `null` en vez de lanzar. Para lo que puede
     * seguir funcionando sin persistirse (la sesión en curso).
     */
    fun sealOrNull(plain: String): String? = runCatching { seal(plain) }.getOrNull()

    /**
     * Abre un valor cifrado. Devuelve null si la clave ya no sirve.
     *
     * Un valor **sin** el prefijo `enc1:` no se acepta: devolverlo tal cual
     * permitía que algo escrito a mano —con acceso al almacén de la app— se
     * colara como cookie o como clave. Lo que no se puede descifrar, no vale.
     */
    fun open(stored: String): String? {
        if (!stored.startsWith(PREFIX)) return null
        return runCatching {
            val merged = Base64.decode(stored.removePrefix(PREFIX), Base64.NO_WRAP)
            require(merged.size > IV_BYTES) { "valor cifrado incompleto" }
            val iv = merged.copyOfRange(0, IV_BYTES)
            val data = merged.copyOfRange(IV_BYTES, merged.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
            String(cipher.doFinal(data), Charsets.UTF_8)
        }.getOrNull()
    }
}
