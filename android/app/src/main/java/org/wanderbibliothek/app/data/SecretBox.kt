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

    /** Cifra un texto. Si el Keystore fallara, se guarda sin prefijo. */
    fun seal(plain: String): String = runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val iv = cipher.iv
        val data = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val merged = ByteArray(iv.size + data.size)
        System.arraycopy(iv, 0, merged, 0, iv.size)
        System.arraycopy(data, 0, merged, iv.size, data.size)
        PREFIX + Base64.encodeToString(merged, Base64.NO_WRAP)
    }.getOrDefault(plain)

    /** Abre un valor cifrado. Devuelve null si la clave ya no sirve. */
    fun open(stored: String): String? {
        if (!stored.startsWith(PREFIX)) return stored
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
