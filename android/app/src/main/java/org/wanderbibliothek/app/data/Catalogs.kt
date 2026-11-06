package org.wanderbibliothek.app.data

/** Listas cerradas que valida el servidor (los valores viajan en castellano). */
object Catalogs {
    val categories = listOf(
        "Humanidades",
        "Ciencias y técnica",
        "Sociedad y política",
        "Biografías",
        "Ficción",
    )

    val languages = listOf(
        "No especificado",
        "Español",
        "Alemán",
        "Inglés",
        "Otro",
    )

    val conditions = listOf(
        "Como nuevo",
        "Muy buen estado",
        "Buen estado",
        "Con señales de uso",
    )

    val tags = listOf(
        "Historia",
        "Filosofía",
        "Ensayo",
        "Literatura",
        "Lengua",
        "Arte",
        "Música",
        "Religión",
        "Poesía",
        "Teatro",
        "Clásicos",
        "Narrativa",
        "Divulgación",
        "Física",
        "Química",
        "Biología",
        "Matemáticas",
        "Astronomía",
        "Medicina",
        "Informática",
        "Ingeniería",
        "Sociología",
        "Política",
        "Economía",
        "Derecho",
        "Antropología",
        "Psicología",
        "Educación",
    )

    private val tagsByCategory = mapOf(
        "Humanidades" to listOf(
            "Historia", "Filosofía", "Literatura", "Lengua", "Arte", "Música",
            "Religión", "Poesía", "Teatro", "Clásicos", "Ensayo",
        ),
        "Ciencias y técnica" to listOf(
            "Divulgación", "Física", "Química", "Biología", "Matemáticas",
            "Astronomía", "Medicina", "Informática", "Ingeniería",
        ),
        "Sociedad y política" to listOf(
            "Sociología", "Política", "Economía", "Derecho", "Antropología",
            "Psicología", "Educación", "Ensayo", "Historia",
        ),
        "Biografías" to listOf("Historia", "Política", "Arte", "Literatura", "Música"),
        "Ficción" to listOf("Narrativa", "Clásicos", "Poesía", "Teatro"),
    )

    fun tagsFor(category: String): List<String> = tagsByCategory[category].orEmpty()
}
