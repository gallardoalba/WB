package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.errorText

@Composable
fun RegisterScreen(
    viewModel: AppViewModel,
    onRegistered: () -> Unit,
    onSignIn: () -> Unit,
) {
    val texts = LocalTexts.current
    val scope = rememberCoroutineScope()

    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var city by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var repeat by rememberSaveable { mutableStateOf("") }
    var ageConfirmed by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        when {
            name.trim().length < 2 || email.isBlank() || city.isBlank() -> {
                error = texts["requiredField"]
                return
            }
            password.length < 10 -> {
                error = texts["passwordMin"]
                return
            }
            password != repeat -> {
                error = texts["passwordMismatch"]
                return
            }
            !ageConfirmed -> {
                error = texts["ageConfirm"]
                return
            }
        }
        scope.launch {
            busy = true
            error = null
            try {
                viewModel.signUp(name, email, city, password, ageConfirmed)
                onRegistered()
            } catch (failure: Exception) {
                error = errorText(texts, failure)
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(texts["registerTitle"], style = MaterialTheme.typography.headlineSmall)
        Text(
            text = texts["registerSubtitle"],
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        error?.let { Notice(it, isError = true) }

        FormField(name, { name = it }, texts["name"], imeAction = ImeAction.Next)
        FormField(
            value = email,
            onValueChange = { email = it },
            label = texts["email"],
            imeAction = ImeAction.Next,
            keyboardType = KeyboardType.Email,
        )
        FormField(city, { city = it }, texts["city"], imeAction = ImeAction.Next)
        FormField(
            value = password,
            onValueChange = { password = it },
            label = texts["password"],
            imeAction = ImeAction.Next,
            password = true,
            supportingText = texts["passwordMin"],
        )
        FormField(
            value = repeat,
            onValueChange = { repeat = it },
            label = texts["passwordRepeat"],
            password = true,
            imeAction = ImeAction.Done,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = ageConfirmed, onCheckedChange = { ageConfirmed = it })
            Text(texts["ageConfirm"], style = MaterialTheme.typography.bodySmall)
        }
        ActionButton(text = texts["register"], loading = busy, onClick = { submit() })
        TextButton(onClick = onSignIn) { Text(texts["haveAccount"]) }
    }
}
