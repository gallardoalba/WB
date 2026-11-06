package org.wanderbibliothek.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import org.wanderbibliothek.app.data.ThemePreference

/*
 * Paleta tomada de los tokens de la web: verde bosque, papel cálido y ocre.
 * Se declaran aquí para que la app no dependa de los CSS del proyecto.
 */
private val LightColors = lightColorScheme(
    primary = Color(0xFF2F5741),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD7E7DB),
    onPrimaryContainer = Color(0xFF10281B),
    secondary = Color(0xFF6B5A3E),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFF0E4CC),
    onSecondaryContainer = Color(0xFF2A2010),
    tertiary = Color(0xFF8A4F32),
    background = Color(0xFFF7F6F1),
    onBackground = Color(0xFF1D211C),
    surface = Color(0xFFFFFDF8),
    onSurface = Color(0xFF1D211C),
    surfaceVariant = Color(0xFFE7E5DC),
    onSurfaceVariant = Color(0xFF4A4F46),
    outline = Color(0xFF7C8175),
    error = Color(0xFF8C1D18),
    onError = Color(0xFFFFFFFF),
)

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
)

@Composable
fun WanderTheme(
    preference: ThemePreference,
    content: @Composable () -> Unit,
) {
    val dark = when (preference) {
        ThemePreference.SYSTEM -> isSystemInDarkTheme()
        ThemePreference.LIGHT -> false
        ThemePreference.DARK -> true
    }
    val view = LocalView.current
    SideEffect {
        // Sin esto, con el tema oscuro los iconos de la barra de estado siguen
        // en negro sobre un fondo casi negro y desaparecen. También se pinta el
        // fondo de la ventana para que no haya un destello blanco al abrir.
        val window = (view.context as? android.app.Activity)?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
        window.decorView.setBackgroundColor(
            (if (dark) DarkColors.background else LightColors.background).toArgb(),
        )
    }
    MaterialTheme(
        colorScheme = if (dark) DarkColors else LightColors,
        content = content,
    )
}
