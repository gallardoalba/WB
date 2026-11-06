package com.example.templateandroid.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF176B57),
    onPrimary = Color.White,
    secondary = Color(0xFF526477),
    tertiary = Color(0xFF8A4F32),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8BD0B6),
    secondary = Color(0xFFB8C8DC),
    tertiary = Color(0xFFFFB68F),
)

@Composable
fun TemplateTheme(
    darkTheme: Boolean,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}