package org.wanderbibliothek.app.ui

/**
 * Traducciones de las enumeraciones cerradas que el servidor guarda en
 * castellano (categorías, estados del ejemplar, idiomas y etiquetas).
 *
 * No se traduce el contenido que escriben las personas, solo las listas
 * curadas del proyecto. En castellano se devuelve el valor tal cual.
 */
object Labels {

    private val de = mapOf(
        // Categorías
        "Humanidades" to "Geisteswissenschaften",
        "Ciencias y técnica" to "Naturwissenschaft & Technik",
        "Sociedad y política" to "Gesellschaft & Politik",
        "Biografías" to "Biografien",
        "Ficción" to "Belletristik",
        // Estado del ejemplar
        "Como nuevo" to "Wie neu",
        "Muy buen estado" to "Sehr gut",
        "Buen estado" to "Gut",
        "Con señales de uso" to "Mit Gebrauchsspuren",
        // Idiomas
        "No especificado" to "Nicht angegeben",
        "Español" to "Spanisch",
        "Alemán" to "Deutsch",
        "Inglés" to "Englisch",
        "Otro" to "Andere",
        "Todos" to "Alle",
        // Etiquetas
        "Historia" to "Geschichte",
        "Filosofía" to "Philosophie",
        "Ensayo" to "Essay",
        "Literatura" to "Literatur",
        "Lengua" to "Sprache",
        "Arte" to "Kunst",
        "Música" to "Musik",
        "Religión" to "Religion",
        "Poesía" to "Poesie",
        "Teatro" to "Theater",
        "Clásicos" to "Klassiker",
        "Narrativa" to "Erzählende Literatur",
        "Divulgación" to "Sachbuch",
        "Física" to "Physik",
        "Química" to "Chemie",
        "Biología" to "Biologie",
        "Matemáticas" to "Mathematik",
        "Astronomía" to "Astronomie",
        "Medicina" to "Medizin",
        "Informática" to "Informatik",
        "Ingeniería" to "Ingenieurwesen",
        "Sociología" to "Soziologie",
        "Política" to "Politik",
        "Economía" to "Wirtschaft",
        "Derecho" to "Recht",
        "Antropología" to "Anthropologie",
        "Psicología" to "Psychologie",
        "Educación" to "Bildung",
    )

    fun of(value: String, lang: String): String = if (lang == "es") value else de[value] ?: value
}
