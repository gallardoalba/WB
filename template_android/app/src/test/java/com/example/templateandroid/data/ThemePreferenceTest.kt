package com.example.templateandroid.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ThemePreferenceTest {
    @Test
    fun fromStorageReadsSupportedValues() {
        assertEquals(ThemePreference.SYSTEM, ThemePreference.fromStorage("system"))
        assertEquals(ThemePreference.LIGHT, ThemePreference.fromStorage("light"))
        assertEquals(ThemePreference.DARK, ThemePreference.fromStorage("dark"))
    }

    @Test
    fun fromStorageDefaultsUnknownValuesToSystem() {
        assertEquals(ThemePreference.SYSTEM, ThemePreference.fromStorage("invalid"))
    }

    @Test
    fun resolveThemePreferenceDefaultsToSystemWhenNothingIsStored() {
        assertEquals(ThemePreference.SYSTEM, resolveThemePreference(null, null))
    }

    @Test
    fun resolveThemePreferenceMigratesLegacyDarkSetting() {
        assertEquals(ThemePreference.DARK, resolveThemePreference(null, true))
        assertEquals(ThemePreference.LIGHT, resolveThemePreference(null, false))
    }

    @Test
    fun resolveThemePreferencePrefersCurrentSettingOverLegacyValue() {
        assertEquals(ThemePreference.LIGHT, resolveThemePreference("light", true))
    }
}