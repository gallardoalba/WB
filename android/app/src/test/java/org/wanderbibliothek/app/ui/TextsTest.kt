package org.wanderbibliothek.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Los dos diccionarios deben tener exactamente las mismas claves. Si alguien
 * añade un texto solo en alemán, la app mostraría la clave cruda en castellano;
 * esta prueba lo detecta antes de compilar el APK.
 */
class TextsTest {

    @Test
    fun `de y es tienen las mismas claves`() {
        val missingInEs = TextCatalog.de.keys - TextCatalog.es.keys
        val missingInDe = TextCatalog.es.keys - TextCatalog.de.keys
        assertEquals("faltan en castellano: $missingInEs", emptySet<String>(), missingInEs)
        assertEquals("faltan en alemán: $missingInDe", emptySet<String>(), missingInDe)
    }

    @Test
    fun `los textos no estan vacios`() {
        TextCatalog.de.forEach { (key, value) ->
            assertNotEquals("clave vacía: $key", "", value.trim())
        }
    }

    @Test
    fun `un idioma desconocido cae en aleman`() {
        assertEquals("Entdecken", TextCatalog.forLanguage("fr")["discover"])
        assertEquals("Descubrir", TextCatalog.forLanguage("es")["discover"])
    }

    @Test
    fun `format sustituye el marcador`() {
        val texts = TextCatalog.forLanguage("es")
        assertEquals("3 libros", texts.format("results", 3))
    }

    @Test
    fun `format no falla si el tipo no encaja`() {
        val texts = TextCatalog.forLanguage("de")
        // `votes` usa `%d`; pasar texto no debe lanzar, solo degradar.
        assertEquals("3 Stimmen", texts.format("votes", "3"))
    }

    /**
     * La barra inferior reparte cinco destinos en el ancho del móvil. Con
     * «Intercambios» (76 dp a 12 sp) no cabe en 360 dp y partía en dos líneas;
     * esta prueba obliga a que las etiquetas cortas sigan siéndolo.
     */
    @Test
    fun `las etiquetas de la barra caben en un movil estrecho`() {
        val keys = listOf("navDiscover", "navShelf", "navExchanges", "navClubs", "navAccount")
        for (catalog in listOf(TextCatalog.de, TextCatalog.es)) {
            keys.forEach { key ->
                val label = catalog.getValue(key)
                assertTrue("demasiado larga para la barra: «$label»", label.length <= 9)
                assertFalse("sin puntos suspensivos: «$label»", label.contains("…"))
            }
        }
    }
}
