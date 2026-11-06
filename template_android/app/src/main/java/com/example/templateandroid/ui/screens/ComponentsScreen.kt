package com.example.templateandroid.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.example.templateandroid.R

internal fun submittedNameOrNull(name: String): String? =
    name.trim().takeIf(String::isNotEmpty)

@Composable
fun ComponentsScreen() {
    var name by rememberSaveable { mutableStateOf("") }
    var submittedName by rememberSaveable { mutableStateOf<String?>(null) }
    var showNameError by rememberSaveable { mutableStateOf(false) }

    fun submitName() {
        val validName = submittedNameOrNull(name)
        if (validName == null) {
            submittedName = null
            showNameError = true
        } else {
            submittedName = validName
            showNameError = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(stringResource(R.string.components_example_title), style = MaterialTheme.typography.titleLarge)
        Spacer(modifier = Modifier.height(16.dp))
        OutlinedTextField(
            value = name,
            onValueChange = {
                name = it
                if (it.isNotBlank()) showNameError = false
            },
            label = { Text(stringResource(R.string.name)) },
            isError = showNameError,
            supportingText = {
                if (showNameError) Text(stringResource(R.string.name_required))
            },
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Words,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { submitName() }),
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(12.dp))
        Button(
            onClick = ::submitName,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(R.string.show_greeting))
        }
        submittedName?.let { enteredName ->
            Spacer(modifier = Modifier.height(16.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = stringResource(
                        R.string.greeting,
                        enteredName,
                    ),
                    modifier = Modifier.padding(16.dp),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }
        }
    }
}