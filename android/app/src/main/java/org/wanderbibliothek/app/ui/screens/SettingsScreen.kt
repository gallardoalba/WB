package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.AppSettings
import org.wanderbibliothek.app.data.DEFAULT_SERVER_URL
import org.wanderbibliothek.app.data.ThemePreference
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.ChoiceChips
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.components.SecondaryButton
import org.wanderbibliothek.app.ui.components.SectionTitle
import org.wanderbibliothek.app.ui.errorText

@Composable
fun SettingsScreen(viewModel: AppViewModel, session: SessionState) {
    val texts = LocalTexts.current
    val settingsValue by viewModel.settings.collectAsStateWithLifecycle()
    val settings = settingsValue
        ?: AppSettings(DEFAULT_SERVER_URL, "system", ThemePreference.SYSTEM)
    val user = (session as? SessionState.SignedIn)?.user
    val scope = rememberCoroutineScope()

    var serverUrl by remember { mutableStateOf(settings.serverUrl) }
    var notice by remember { mutableStateOf<String?>(null) }
    var isError by remember { mutableStateOf(false) }

    var keyStatus by remember { mutableStateOf("unknown") }
    var askPassword by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }

    suspend fun refreshKey() {
        keyStatus = try {
            if (user == null) return
            val identity = viewModel.repo.ensureIdentity(user.id)
            val server = viewModel.repo.serverKeyId("android")
            when {
                server == null -> "missing"
                server == identity.keyId -> "ok"
                else -> "different"
            }
        } catch (_: Exception) {
            "unknown"
        }
    }

    LaunchedEffect(settings.serverUrl, user?.id) {
        serverUrl = settings.serverUrl
        if (user != null) refreshKey()
    }

    if (askPassword) {
        AlertDialog(
            onDismissRequest = { askPassword = false },
            title = { Text(texts["passwordForKey"]) },
            text = {
                FormField(
                    value = password,
                    onValueChange = { password = it },
                    label = texts["password"],
                    password = true,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    askPassword = false
                    scope.launch {
                        val account = user ?: return@launch
                        try {
                            viewModel.repo.publishKey(account.id, password, "android")
                            password = ""
                            refreshKey()
                            notice = texts["keyPublished"]
                            isError = false
                        } catch (failure: Exception) {
                            notice = errorText(texts, failure)
                            isError = true
                        }
                    }
                }) { Text(texts["save"]) }
            },
            dismissButton = {
                TextButton(onClick = { askPassword = false }) { Text(texts["cancel"]) }
            },
        )
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        notice?.let { Notice(it, isError = isError) }

        SectionTitle(texts["appLanguage"])
        ChoiceChips(
            options = listOf(
                "system" to texts["languageSystem"],
                "de" to texts["german"],
                "es" to texts["spanish"],
            ),
            selected = settings.language,
            onSelect = { language -> scope.launch { viewModel.setLanguage(language) } },
        )

        SectionTitle(texts["theme"])
        ChoiceChips(
            options = listOf(
                ThemePreference.SYSTEM.storageValue to texts["themeSystem"],
                ThemePreference.LIGHT.storageValue to texts["themeLight"],
                ThemePreference.DARK.storageValue to texts["themeDark"],
            ),
            selected = settings.theme.storageValue,
            onSelect = { value ->
                scope.launch { viewModel.setTheme(ThemePreference.fromStorage(value)) }
            },
        )

        SectionTitle(texts["serverUrl"])
        Text(
            text = texts["serverHint"],
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        FormField(
            value = serverUrl,
            onValueChange = { serverUrl = it },
            label = texts["serverUrl"],
            keyboardType = KeyboardType.Uri,
        )
        SecondaryButton(
            text = texts["apply"],
            onClick = {
                val normalized = serverUrl.trim().trimEnd('/')
                if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
                    notice = texts["invalidServer"]
                    isError = true
                } else {
                    scope.launch {
                        viewModel.setServerUrl(normalized)
                        notice = texts["save"]
                        isError = false
                    }
                }
            },
        )

        if (session is SessionState.SignedIn) {
            SectionTitle(texts["encryptionDevice"])
            when (keyStatus) {
                "ok" -> Notice(texts["keyOk"])
                "missing" -> {
                    Notice(texts["keyMissing"])
                    // El servidor pide la contraseña en cuanto la cuenta tiene
                    // cualquier clave (por ejemplo, la del navegador), así que
                    // aquí se pide siempre: intentarlo sin ella solo daría 428.
                    ActionButton(
                        text = texts["enableKey"],
                        onClick = { askPassword = true },
                    )
                }
                "different" -> {
                    Notice(texts["keyDifferent"], isError = true)
                    ActionButton(
                        text = texts["enableKey"],
                        onClick = { askPassword = true },
                    )
                }
                else -> Notice(texts["keyMissing"])
            }
        }
    }
}
