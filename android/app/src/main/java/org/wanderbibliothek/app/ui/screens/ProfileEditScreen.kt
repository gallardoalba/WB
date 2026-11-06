package org.wanderbibliothek.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.ui.AppViewModel
import org.wanderbibliothek.app.ui.LocalTexts
import org.wanderbibliothek.app.ui.SessionState
import org.wanderbibliothek.app.ui.components.ActionButton
import org.wanderbibliothek.app.ui.components.FormField
import org.wanderbibliothek.app.ui.components.Notice
import org.wanderbibliothek.app.ui.errorText

/**
 * Editar el perfil: nombre, ciudad, presentación y avisos por correo.
 *
 * El correo no se puede cambiar aquí: el servidor lo trata como identidad y
 * pide el flujo de verificación completo en la web.
 */
@Composable
fun ProfileEditScreen(
    viewModel: AppViewModel,
    session: SessionState,
    onSaved: () -> Unit,
) {
    val texts = LocalTexts.current
    val scope = rememberCoroutineScope()
    val user = (session as? SessionState.SignedIn)?.user
    if (user == null) {
        SignInPrompt(texts, text = texts["notSignedIn"], onSignIn = onSaved)
        return
    }

    var name by rememberSaveable(user.id) { mutableStateOf(user.name) }
    var city by rememberSaveable(user.id) { mutableStateOf(user.city) }
    var bio by rememberSaveable(user.id) { mutableStateOf(user.bio) }
    var alerts by rememberSaveable(user.id) { mutableStateOf(user.emailNotifications) }
    var busy by rememberSaveable { mutableStateOf(false) }
    var message by rememberSaveable { mutableStateOf<String?>(null) }
    var isError by rememberSaveable { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        message?.let { Notice(it, isError = isError) }

        FormField(
            value = name,
            onValueChange = { name = it },
            label = texts["name"],
            enabled = !busy,
        )
        FormField(
            value = city,
            onValueChange = { city = it },
            label = texts["city"],
            enabled = !busy,
        )
        FormField(
            value = bio,
            onValueChange = { bio = it },
            label = texts["bio"],
            singleLine = false,
            enabled = !busy,
            supportingText = texts["bioHint"],
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(texts["emailNotifications"], style = MaterialTheme.typography.bodyLarge)
                Text(
                    text = texts["emailNotificationsHint"],
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = alerts, onCheckedChange = { alerts = it }, enabled = !busy)
        }

        Text(
            text = user.email,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        ActionButton(
            text = texts["save"],
            loading = busy,
            enabled = name.isNotBlank() && city.isNotBlank(),
            onClick = {
                scope.launch {
                    busy = true
                    message = null
                    try {
                        viewModel.saveProfile(name.trim(), city.trim(), bio.trim(), alerts)
                        message = texts["profileSaved"]
                        isError = false
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
