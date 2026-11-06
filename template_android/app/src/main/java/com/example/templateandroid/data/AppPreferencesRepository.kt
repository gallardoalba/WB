package com.example.templateandroid.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "app_preferences")

enum class ThemePreference(val storageValue: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark");

    companion object {
        fun fromStorage(value: String): ThemePreference =
            entries.firstOrNull { it.storageValue == value } ?: SYSTEM
    }
}

internal fun resolveThemePreference(
    storedTheme: String?,
    legacyDarkTheme: Boolean?,
): ThemePreference = storedTheme?.let(ThemePreference::fromStorage)
    ?: legacyDarkTheme?.let { isDark ->
        if (isDark) ThemePreference.DARK else ThemePreference.LIGHT
    }
    ?: ThemePreference.SYSTEM

class AppPreferencesRepository(context: Context) {
    private val dataStore = context.applicationContext.dataStore

    val themePreference: Flow<ThemePreference> = dataStore.data.map { preferences ->
        resolveThemePreference(
            storedTheme = preferences[THEME_PREFERENCE],
            legacyDarkTheme = preferences[LEGACY_DARK_THEME],
        )
    }

    suspend fun setThemePreference(themePreference: ThemePreference) {
        dataStore.edit { preferences ->
            preferences[THEME_PREFERENCE] = themePreference.storageValue
        }
    }

    private companion object {
        val THEME_PREFERENCE = stringPreferencesKey("theme_preference")
        val LEGACY_DARK_THEME = booleanPreferencesKey("dark_theme")
    }
}