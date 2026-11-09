package org.wanderbibliothek.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import org.wanderbibliothek.app.ui.WanderApp
import java.io.File
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Las exportaciones de la cuenta se guardan en la caché para compartirlas
        // y llevan datos personales en claro: al arrancar no debe quedar ninguna.
        thread {
            File(cacheDir, "export").listFiles()?.forEach { it.delete() }
        }
        setContent {
            WanderApp()
        }
    }
}
