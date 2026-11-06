package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.errorText

/** Cambiar la contraseña: la actual se comprueba en el servidor, aquí no. */
@Composable
fun PasswordScreen(viewModel: AppViewModel, onChanged: () -> Unit) {
    val texts = LocalTexts.current
    val scope = rememberCoroutineScope()

    var current by rememberSaveable { mutableStateOf("") }
    var next by rememberSaveable { mutableStateOf("") }
    var repeat by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var message by rememberSaveable { mutableStateOf<String?>(null) }
    var isError by rememberSaveable { mutableStateOf(false) }

    val tooShort = next.isNotEmpty() && next.length < 10
    val mismatch = repeat.isNotEmpty() && next != repeat

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        message?.let { Notice(it, isError = isError) }

        FormField(
            value = current,
            onValueChange = { current = it },
            label = texts["currentPassword"],
            password = true,
            enabled = !busy,
        )
        FormField(
            value = next,
            onValueChange = { next = it },
            label = texts["newPassword"],
            password = true,
            enabled = !busy,
            supportingText = if (tooShort) texts["passwordMin"] else null,
        )
        FormField(
            value = repeat,
            onValueChange = { repeat = it },
            label = texts["passwordRepeat"],
            password = true,
            enabled = !busy,
            supportingText = if (mismatch) texts["passwordMismatch"] else null,
        )

        ActionButton(
            text = texts["changePassword"],
            loading = busy,
            enabled = current.isNotEmpty() && next.length >= 10 && next == repeat,
            onClick = {
                scope.launch {
                    busy = true
                    message = null
                    try {
                        viewModel.repo.changePassword(current, next)
                        current = ""
                        next = ""
                        repeat = ""
                        message = texts["passwordChanged"]
                        isError = false
                        onChanged()
                    } catch (failure: Exception) {
                        message = errorText(texts, failure)
                        isError = true
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}
