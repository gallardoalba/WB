package org.wanderbibliothek.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Lectura del JSON del servidor: lo que no puede romperse sin que la app deje
 * de cifrar o de enseñar mensajes.
 */
class ModelsTest {

    @Test
    fun `un mensaje v40 trae un sobre por clave`() {
        val json = JSONObject(
            """
            {
              "id": "msg_1",
              "encrypted": true,
              "createdAt": "2026-01-02T10:00:00.000Z",
              "sender": { "id": "usr_a", "name": "Ana" },
              "envelopes": [
                { "keyId": "k_web", "ciphertext": "ccc", "iv": "iii" },
                { "keyId": "k_app", "ciphertext": "ddd", "iv": "jjj" }
              ]
            }
            """.trimIndent(),
        )

        val message = Message.from(json)

        assertTrue(message.encrypted)
        assertEquals(2, message.envelopes.size)
        assertEquals("k_app", message.envelopes[1].keyId)
        assertEquals("ddd", message.envelopes[1].ciphertext)
        assertEquals("usr_a", message.senderId)
    }

    @Test
    fun `un mensaje antiguo sin sobres usa su unico ciphertext`() {
        val json = JSONObject(
            """
            {
              "id": "msg_2",
              "encrypted": true,
              "ciphertext": "legacy",
              "iv": "ivlegacy",
              "keyId": "k_old",
              "sender": { "id": "usr_b" }
            }
            """.trimIndent(),
        )

        val message = Message.from(json)

        assertEquals(1, message.envelopes.size)
        assertEquals("legacy", message.envelopes[0].ciphertext)
        assertEquals("k_old", message.envelopes[0].keyId)
    }

    @Test
    fun `los sobres incompletos se descartan sin tumbar el mensaje`() {
        val json = JSONObject(
            """
            {
              "id": "msg_3",
              "encrypted": true,
              "sender": { "id": "usr_c" },
              "envelopes": [
                { "keyId": "k_ok", "ciphertext": "a", "iv": "b" },
                { "keyId": "k_sin_cifrado", "iv": "b" },
                { "ciphertext": "a", "iv": "b" }
              ]
            }
            """.trimIndent(),
        )

        val message = Message.from(json)

        assertEquals(1, message.envelopes.size)
        assertEquals("k_ok", message.envelopes[0].keyId)
    }

    @Test
    fun `el detalle de un libro toma el propietario y los campos opcionales`() {
        val json = JSONObject(
            """
            {
              "id": "lst_1",
              "title": "El nombre del viento",
              "author": "Patrick Rothfuss",
              "category": "fantasy",
              "language": "es",
              "condition": "good",
              "city": "Leipzig",
              "distanceKm": 3.5,
              "owner": { "id": "usr_a", "name": "Ana" },
              "tags": ["clasico", "favorito"],
              "coverUrl": "/api/cover/1"
            }
            """.trimIndent(),
        )

        val listing = Listing.from(json)

        assertEquals("usr_a", listing.ownerId)
        assertEquals("Ana", listing.ownerName)
        assertEquals(3.5, listing.distanceKm!!, 0.001)
        assertEquals(listOf("clasico", "favorito"), listing.tags)
        assertEquals("available", listing.status)
        assertNull(listing.isbn)
    }

    @Test
    fun `el usuario lee los avisos por correo y el idioma`() {
        val json = JSONObject(
            """
            {
              "id": "usr_a",
              "name": "Ana",
              "email": "ana@example.test",
              "city": "Leipzig",
              "emailVerified": true,
              "emailNotifications": true
            }
            """.trimIndent()
        )

        val user = User.from(json)

        assertTrue(user.emailNotifications)
        assertTrue(user.emailVerified)
        assertEquals("de", user.locale)
    }

    @Test
    fun `el estado de dos pasos distingue activo y pendiente`() {
        val active = TotpState.from(JSONObject("""{"enabled":true,"pending":false}"""))
        val pending = TotpState.from(JSONObject("""{"enabled":false,"pending":true}"""))

        assertTrue(active.enabled)
        assertTrue(pending.pending)
    }
}
