package com.example.templateandroid.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.example.templateandroid.R
import com.example.templateandroid.data.ThemePreference

@Composable
fun SettingsScreen(
    themePreference: ThemePreference,
    onThemePreferenceChange: (ThemePreference) -> Unit,
) {
    Column(
        modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 12.dp),
                verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                    Text(stringResource(R.string.settings_appearance), style = MaterialTheme.typography.titleMedium)
                Text(
                    stringResource(R.string.settings_saved_on_device),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ThemePreference.entries.forEach { option ->
                val labelRes = when (option) {
                    ThemePreference.SYSTEM -> R.string.theme_system
                    ThemePreference.LIGHT -> R.string.theme_light
                    ThemePreference.DARK -> R.string.theme_dark
                }
                FilterChip(
                    selected = themePreference == option,
                    onClick = { onThemePreferenceChange(option) },
                    label = { Text(stringResource(labelRes)) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}