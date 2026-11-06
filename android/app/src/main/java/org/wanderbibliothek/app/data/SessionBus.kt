package org.wanderbibliothek.app.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Aviso global de sesión caducada.
 *
 * El cliente HTTP puede recibir un 401 desde cualquier pantalla; el ViewModel
 * escucha este flujo y pasa el estado a «sin sesión», para que la interfaz no
 * siga mostrando una cuenta que ya no vale.
 */
object SessionBus {
    private val _expired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val expired = _expired.asSharedFlow()

    fun notifyExpired() {
        _expired.tryEmit(Unit)
    }
}
