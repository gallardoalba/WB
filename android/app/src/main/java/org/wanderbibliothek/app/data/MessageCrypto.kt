package org.wanderbibliothek.app.data

import android.util.Base64
import org.json.JSONObject
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECParameterSpec
import java.security.spec.ECPublicKeySpec
import java.security.spec.PKCS8EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Cifrado de extremo a extremo de los mensajes, compatible con `src/lib/e2e.ts`.
 *
 * Esquema (idéntico al de la web, para que el móvil y el navegador hablen el
 * mismo idioma):
 * - Par ECDH P-256 por dispositivo; la pública se publica en la cuenta.
 * - Clave AES-GCM-256 por conversación = ECDH + HKDF-SHA256 con `info` =
 *   `wanderbibliothek:request:<id>` y `salt` = `wanderbibliothek:v1`.
 * - El sobre que viaja al servidor es `{ciphertext, iv}` en base64 estándar.
 * - El AAD ata el sobre al hilo, al remitente y a la clave usada.
 *
 * El servidor nunca ve la clave privada: solo la mitad pública.
 */
object MessageCrypto {

    const val HKDF_SALT = "wanderbibliothek:v1"

    data class Identity(
        val keyId: String,
        val publicJwk: JSONObject,
        val privateKey: PrivateKey,
    )

    private val p256: ECParameterSpec by lazy {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        (generator.generateKeyPair().public as ECPublicKey).params
    }

    /** Crea una identidad nueva y devuelve también su clave privada en PKCS#8. */
    fun generateIdentity(): Pair<Identity, ByteArray> {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"))
        val pair = generator.generateKeyPair()
        val privateKey = pair.private
        val jwk = publicJwk(pair.public as ECPublicKey)
        return Identity(keyIdOf(jwk), jwk, privateKey) to privateKey.encoded
    }

    fun restore(record: IdentityRecord): Identity? = runCatching {
        val factory = KeyFactory.getInstance("EC")
        val privateKey = factory.generatePrivate(PKCS8EncodedKeySpec(record.privateKeyPkcs8))
        Identity(record.keyId, record.publicJwk, privateKey)
    }.getOrNull()

    fun publicJwk(publicKey: ECPublicKey): JSONObject {
        val x = fixed32(publicKey.w.affineX)
        val y = fixed32(publicKey.w.affineY)
        return JSONObject()
            .put("kty", "EC")
            .put("crv", "P-256")
            .put("x", base64Url(x))
            .put("y", base64Url(y))
    }

    /** Misma huella que la web: SHA-256 de `kty.crv.x.y` en base64url sin relleno. */
    fun keyIdOf(jwk: JSONObject): String {
        val canonical = "EC.P-256.${jwk.getString("x")}.${jwk.getString("y")}"
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
        return base64Url(digest)
    }

    /** Clave AES-GCM de una conversación concreta. */
    fun conversationKey(identity: Identity, peerJwk: JSONObject, requestId: String): SecretKeySpec {
        val peer = publicKeyOf(peerJwk)
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(identity.privateKey)
        agreement.doPhase(peer, true)
        val shared = agreement.generateSecret()
        val secret = hkdf(
            shared = shared,
            salt = HKDF_SALT.toByteArray(Charsets.UTF_8),
            info = "wanderbibliothek:request:$requestId".toByteArray(Charsets.UTF_8),
        )
        return SecretKeySpec(secret, "AES")
    }

    fun encrypt(key: SecretKeySpec, text: String, aad: String): Pair<String, String> {
        val iv = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
        cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        val ciphertext = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        return base64(ciphertext) to base64(iv)
    }

    /** Devuelve `null` si la clave no corresponde (mensaje de otro dispositivo). */
    fun decrypt(
        key: SecretKeySpec,
        ciphertext: String,
        iv: String,
        aad: String,
    ): String? = runCatching {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        cipher.updateAAD(aad.toByteArray(Charsets.UTF_8))
        String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), Charsets.UTF_8)
    }.getOrNull()

    fun requestAad(requestId: String, senderId: String, keyId: String): String =
        "wanderbibliothek:v1|request:$requestId|sender:$senderId|key:$keyId"

    private fun publicKeyOf(jwk: JSONObject): ECPublicKey {
        require(jwk.optString("kty") == "EC" && jwk.optString("crv") == "P-256") {
            "La clave pública no es P-256."
        }
        val point = ECPoint(
            BigInteger(1, Base64.decode(jwk.getString("x"), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)),
            BigInteger(1, Base64.decode(jwk.getString("y"), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)),
        )
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, p256)) as ECPublicKey
    }

    /** HKDF-SHA256 (RFC 5869) para una sola clave de 32 bytes. */
    private fun hkdf(shared: ByteArray, salt: ByteArray, info: ByteArray): ByteArray {
        val prk = hmac(salt, shared)
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(prk, "HmacSHA256"))
        mac.update(info)
        mac.update(1.toByte())
        return mac.doFinal()
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    private fun fixed32(value: BigInteger): ByteArray {
        val bytes = value.toByteArray()
        val out = ByteArray(32)
        if (bytes.size >= 32) {
            System.arraycopy(bytes, bytes.size - 32, out, 0, 32)
        } else {
            System.arraycopy(bytes, 0, out, 32 - bytes.size, bytes.size)
        }
        return out
    }

    private fun base64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun base64Url(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
