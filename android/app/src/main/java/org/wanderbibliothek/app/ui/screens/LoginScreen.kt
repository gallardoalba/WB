package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.LoginOutcome
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.errorText

@Composable
fun LoginScreen(
    viewModel: AppViewModel,
    onSignedIn: () -> Unit,
    onRegister: () -> Unit,
) {
    val texts = LocalTexts.current
    val scope = rememberCoroutineScope()

    var email by rememberSaveable { mutableStateOf("") }
    // `remember` y no `rememberSaveable`: la contraseña no debe acabar en el
    // estado guardado del Activity, que el sistema escribe en disco.
    var password by remember { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var needsCode by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by rememberSaveable { mutableStateOf<String?>(null) }

    fun submit() {
        if (email.isBlank() || password.isBlank()) {
            error = texts["requiredField"]
            return
        }
        scope.launch {
            busy = true
            error = null
            try {
                when (viewModel.signIn(email, password, code.takeIf { needsCode })) {
                    LoginOutcome.NeedsTwoFactor -> needsCode = true
                    is LoginOutcome.Success -> onSignedIn()
                }
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
        Text(texts["loginTitle"], style = MaterialTheme.typography.headlineSmall)
        Text(
            text = texts["loginSubtitle"],
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        error?.let { Notice(it, isError = true) }
        notice?.let { Notice(it) }

        FormField(
            value = email,
            onValueChange = { email = it },
            label = texts["email"],
            keyboardType = KeyboardType.Email,
            imeAction = ImeAction.Next,
        )
        FormField(
            value = password,
            onValueChange = { password = it },
            label = texts["password"],
            password = true,
            imeAction = ImeAction.Done,
        )
        if (needsCode) {
            FormField(
                value = code,
                onValueChange = { code = it },
                label = texts["twoFactorCode"],
                keyboardType = KeyboardType.Number,
            )
        }
        ActionButton(
            text = texts["signIn"],
            loading = busy,
            onClick = { submit() },
        )
        TextButton(
            enabled = !busy,
            onClick = {
                if (email.isBlank()) {
                    error = texts["emailRequiredForReset"]
                    return@TextButton
                }
                scope.launch {
                    busy = true
                    error = null
                    try {
                        viewModel.repo.requestPasswordReset(email)
                        // Mismo mensaje exista o no la cuenta: el servidor no
                        // revela si el correo está registrado.
                        notice = texts["resetSent"]
                    } catch (failure: Exception) {
                        error = errorText(texts, failure)
                    } finally {
                        busy = false
                    }
                }
            },
        ) { Text(texts["forgotPassword"]) }
        TextButton(onClick = onRegister) { Text(texts["noAccount"]) }
    }
}
