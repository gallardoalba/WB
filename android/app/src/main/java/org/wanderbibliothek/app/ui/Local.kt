package org.wanderbibliothek.app.ui

import androidx.compose.runtime.staticCompositionLocalOf

/** Textos del idioma elegido; las pantallas los leen sin pasarlos por parámetro. */
val LocalTexts = staticCompositionLocalOf { TextCatalog.forLanguage("de") }

/** Código del idioma activo (`de` o `es`), para fechas y etiquetas. */
val LocalLang = staticCompositionLocalOf { "de" }
