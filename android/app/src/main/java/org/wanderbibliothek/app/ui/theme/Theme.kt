package org.wanderbibliothek.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/*
 * Paleta tomada de los tokens de la web: verde bosque, papel cálido y ocre.
 * Se declaran aquí para que la app no dependa de los CSS del proyecto.
 *
 * La app es solo oscura: no hay modo claro ni opción de seguir al sistema.
 */
private val DarkColors = darkColorScheme(
    primary = Color(0xFF9FD3B4),
    onPrimary = Color(0xFF0A2114),
    primaryContainer = Color(0xFF243D2D),
    onPrimaryContainer = Color(0xFFCFE9D8),
    secondary = Color(0xFFD9C6A2),
    onSecondary = Color(0xFF2B2314),
    secondaryContainer = Color(0xFF3A3222),
    onSecondaryContainer = Color(0xFFF0E4CC),
    tertiary = Color(0xFFFFB68F),
    background = Color(0xFF12150F),
    onBackground = Color(0xFFE4E6DE),
    surface = Color(0xFF1A1E17),
    onSurface = Color(0xFFE4E6DE),
    surfaceVariant = Color(0xFF2C3129),
    onSurfaceVariant = Color(0xFFC2C7BC),
    outline = Color(0xFF8A9184),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF5C1A16),
    onErrorContainer = Color(0xFFFFDAD6),
)

@Composable
fun WanderTheme(content: @Composable () -> Unit) {
    val view = LocalView.current
    SideEffect {
        // Sin esto los iconos de la barra de estado seguirían en negro sobre un
        // fondo casi negro y desaparecerían. También se pinta el fondo de la
        // ventana para que no haya un destello blanco al abrir.
        val window = (view.context as? android.app.Activity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
        window.decorView.setBackgroundColor(DarkColors.background.toArgb())
    }
    MaterialTheme(
        colorScheme = DarkColors,
        content = content,
    )
}
