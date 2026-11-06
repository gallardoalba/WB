package org.wanderbibliothek.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Las portadas llegan como ruta relativa y se resuelven contra el servidor. */
class ImageUrlTest {

    @Test
    fun `una ruta absoluta se une al servidor`() {
        ImageUrl.baseUrl = "https://wanderbibliothek.org"
        assertEquals(
            "https://wanderbibliothek.org/api/cover/1",
            ImageUrl.resolve("/api/cover/1"),
        )
    }

    @Test
    fun `no se duplica la barra final`() {
        ImageUrl.baseUrl = "https://wanderbibliothek.org/"
        assertEquals(
            "https://wanderbibliothek.org/api/cover/1",
            ImageUrl.resolve("/api/cover/1"),
        )
    }

    @Test
    fun `una url completa se deja tal cual`() {
        ImageUrl.baseUrl = "https://example.test"
        assertEquals(
            "https://cdn.example.test/x.jpg",
            ImageUrl.resolve("https://cdn.example.test/x.jpg"),
        )
    }

    @Test
    fun `sin url no hay imagen`() {
        assertNull(ImageUrl.resolve(null))
        assertNull(ImageUrl.resolve("   "))
    }
}
