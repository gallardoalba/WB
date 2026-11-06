package com.example.templateandroid.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.templateandroid.data.AppPreferencesRepository
import com.example.templateandroid.data.ThemePreference
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = AppPreferencesRepository(application)

    val themePreference = preferences.themePreference.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = ThemePreference.SYSTEM,
    )

    fun setThemePreference(themePreference: ThemePreference) {
        viewModelScope.launch {
            preferences.setThemePreference(themePreference)
        }
    }
}