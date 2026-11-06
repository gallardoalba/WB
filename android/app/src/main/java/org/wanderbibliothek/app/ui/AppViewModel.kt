package org.wanderbibliothek.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.wanderbibliothek.app.data.ApiClient
import org.wanderbibliothek.app.data.AppSettings
import org.wanderbibliothek.app.data.ImageUrl
import org.wanderbibliothek.app.data.Languages
import org.wanderbibliothek.app.data.LoginOutcome
import org.wanderbibliothek.app.data.Prefs
import org.wanderbibliothek.app.data.SessionBus
import org.wanderbibliothek.app.data.ThemePreference
import org.wanderbibliothek.app.data.User
import org.wanderbibliothek.app.data.WanderRepository

sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    data class SignedIn(val user: User) : SessionState
}

class AppViewModel(application: Application) : AndroidViewModel(application) {
    val prefs = Prefs(application)
    private val api = ApiClient(prefs)
    val repo = WanderRepository(api, prefs)

    val settings: StateFlow<AppSettings?> = prefs.settings.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = null,
    )

    private val _session = MutableStateFlow<SessionState>(SessionState.Loading)
    val session: StateFlow<SessionState> = _session.asStateFlow()

    /** Avisos sin leer: se refresca solo para el distintivo de la campana. */
    private val _unread = MutableStateFlow(0)
    val unread: StateFlow<Int> = _unread.asStateFlow()

    init {
        // Cualquier 401 de la API deja la app en «sin sesión» sin esperar a que
        // el usuario reinicie.
        viewModelScope.launch {
            SessionBus.expired.collect { _session.value = SessionState.SignedOut }
        }
        // El contador se refresca al arrancar y cada minuto mientras haya
        // sesión: sin esto el distintivo nunca aparecía.
        viewModelScope.launch {
            while (true) {
                if (_session.value is SessionState.SignedIn) refreshUnread()
                delay(60_000)
            }
        }
        refreshSession()
    }

    suspend fun refreshUnread() {
        _unread.value = runCatching {
            if (_session.value is SessionState.SignedIn) repo.unreadNotifications() else 0
        }.getOrDefault(0)
    }

    fun refreshSession() {
        viewModelScope.launch {
            _session.value = try {
                val user = repo.me()
                if (user == null) {
                    SessionState.SignedOut
                } else {
                    prepareEncryption(user.id, password = null)
                    SessionState.SignedIn(user)
                }
            } catch (_: Exception) {
                // Sin red al arrancar se entra como visitante; las pantallas que
                // necesitan sesión explican qué hacer.
                SessionState.SignedOut
            }
        }
    }

    suspend fun signIn(email: String, password: String, code: String?): LoginOutcome {
        val outcome = repo.login(email, password, code)
        if (outcome is LoginOutcome.Success) {
            val user = runCatching { repo.me() }.getOrNull() ?: outcome.user
            // La primera clave es TOFU: si la cuenta no tiene ninguna, este
            // dispositivo publica la suya sin pedir nada. Si ya hay otra, no se
            // toca: cambiar la clave exige contraseña y lo pide Ajustes.
            prepareEncryption(user.id, password)
            _session.value = SessionState.SignedIn(user)
            syncLocale()
        }
        return outcome
    }

    suspend fun signUp(
        name: String,
        email: String,
        city: String,
        password: String,
        ageConfirmed: Boolean,
    ): User {
        val user = repo.register(name, email, city, password, ageConfirmed)
        prepareEncryption(user.id, password)
        _session.value = SessionState.SignedIn(user)
        syncLocale()
        return user
    }

    /** Guarda el perfil y actualiza la sesión con la respuesta del servidor. */
    suspend fun saveProfile(
        name: String,
        city: String,
        bio: String,
        emailNotifications: Boolean,
    ): User {
        val user = repo.updateProfile(name, city, bio, emailNotifications)
        _session.value = SessionState.SignedIn(user)
        return user
    }

    /** Baja de cuenta: el servidor cierra la sesión y aquí se borra la clave local. */
    suspend fun deleteAccount(password: String) {
        val user = (_session.value as? SessionState.SignedIn)?.user ?: return
        repo.deleteAccount(user.id, password)
        _session.value = SessionState.SignedOut
    }

    fun signOut() {
        viewModelScope.launch {
            repo.logout()
            _session.value = SessionState.SignedOut
        }
    }

    fun updateUser(user: User) {
        _session.value = SessionState.SignedIn(user)
    }

    suspend fun setTheme(theme: ThemePreference) {
        prefs.setTheme(theme)
    }

    suspend fun setServerUrl(url: String) {
        // La cookie de sesión es de otro servidor: enviarla al nuevo sería un
        // fallo de seguridad (y una sesión inválida). Se cierra la sesión.
        prefs.clearSession()
        prefs.setServerUrl(url)
        ImageUrl.baseUrl = url
        refreshSession()
    }

    /**
     * Asegura que este dispositivo tiene identidad y, si la cuenta aún no
     * publicó ninguna clave, la publica. Cualquier fallo se ignora: no debe
     * impedir usar el resto de la app.
     */
    private suspend fun prepareEncryption(userId: String, password: String?) {
        runCatching {
            repo.ensureIdentity(userId)
            // La app usa su propia ranura: si aún no existe se publica (TOFU).
            // La clave del navegador no se toca desde aquí.
            if (repo.serverKeyId("android") == null) {
                repo.publishKey(userId, password, "android")
            }
        }
    }

    /**
     * La app no tiene selector de idioma: sigue al del teléfono. Al entrar se
     * guarda esa preferencia en la cuenta para que los avisos y los correos
     * lleguen en el mismo idioma que se está viendo. El fallo se ignora: es una
     * comodidad, no un requisito para usar la app.
     */
    private suspend fun syncLocale() {
        runCatching { repo.updateLocale(Languages.fromSystem()) }
    }
}
