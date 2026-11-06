package org.wanderbibliothek.app.data

import org.json.JSONObject
import java.net.URLEncoder

sealed interface LoginOutcome {
    data class Success(val user: User) : LoginOutcome
    /** La cuenta tiene doble factor: hay que repetir el acceso con el código. */
    data object NeedsTwoFactor : LoginOutcome
}

data class IsbnResult(val metadata: IsbnMetadata?, val existingTitle: String?)

data class DecryptedMessage(val message: Message, val text: String?)

/**
 * Toda la API de Wanderbibliothek, en un solo sitio.
 *
 * Las pantallas no construyen URLs ni leen JSON: piden datos ya tipados. Así,
 * si el servidor cambia una forma, hay un único punto que tocar.
 */
class WanderRepository(private val api: ApiClient, private val prefs: Prefs) {

    /* -------------------------------- sesión -------------------------------- */

    suspend fun me(): User? {
        val json = try {
            api.get("/api/auth/me")
        } catch (_: SessionExpiredException) {
            return null
        }
        val user = json.optJSONObject("user") ?: return null
        return User.from(user)
    }

    /**
     * Pide el enlace de recuperación. El servidor responde siempre lo mismo
     * (exista o no la cuenta), así que aquí no se puede distinguir.
     */
    suspend fun requestPasswordReset(email: String) {
        api.post("/api/auth/forgot", JSONObject().put("email", email.trim()))
    }

    suspend fun login(email: String, password: String, code: String?): LoginOutcome {
        val body = JSONObject().put("email", email.trim()).put("password", password)
        if (!code.isNullOrBlank()) body.put("code", code.trim())
        val json = try {
            api.post("/api/auth/login", body)
        } catch (error: ApiException) {
            if (error.payload?.optBoolean("twoFactorRequired") == true) {
                return LoginOutcome.NeedsTwoFactor
            }
            throw error
        }
        return LoginOutcome.Success(User.from(json.getJSONObject("user")))
    }

    suspend fun register(
        name: String,
        email: String,
        city: String,
        password: String,
        ageConfirmed: Boolean,
    ): User {
        val body = JSONObject()
            .put("name", name.trim())
            .put("email", email.trim())
            .put("city", city.trim())
            .put("password", password)
            .put("ageConfirmed", ageConfirmed)
            .put("website", "")
            .put("startedAt", System.currentTimeMillis() - 5_000)
        val json = api.post("/api/auth/register", body)
        return User.from(json.getJSONObject("user"))
    }

    suspend fun logout() {
        runCatching { api.post("/api/auth/logout") }
        prefs.clearSession()
    }

    suspend fun updateLocale(language: String) {
        api.post("/api/account/locale", JSONObject().put("locale", language))
    }

    /* -------------------------------- cuenta -------------------------------- */

    suspend fun updateProfile(
        name: String,
        city: String,
        bio: String,
        emailNotifications: Boolean,
    ): User {
        val body = JSONObject()
            .put("name", name.trim())
            .put("city", city.trim())
            .put("bio", bio.trim())
            .put("emailNotifications", emailNotifications)
        return User.from(api.patch("/api/account/profile", body).getJSONObject("user"))
    }

    suspend fun changePassword(currentPassword: String, newPassword: String) {
        api.patch(
            "/api/account/password",
            JSONObject()
                .put("currentPassword", currentPassword)
                .put("newPassword", newPassword),
        )
    }

    /** Borra la cuenta y su identidad local; el servidor cierra la sesión. */
    suspend fun deleteAccount(userId: String, password: String) {
        api.post("/api/account/delete", JSONObject().put("password", password))
        prefs.clearIdentity(identityScope(userId))
        prefs.clearSession()
    }

    suspend fun exportData(): String = api.getText("/api/account/export")

    suspend fun totpState(): TotpState = TotpState.from(api.get("/api/account/totp"))

    suspend fun startTotp(password: String): TotpSetup =
        TotpSetup.from(
            api.post("/api/account/totp/setup", JSONObject().put("password", password)),
        )

    suspend fun enableTotp(code: String): TotpState =
        TotpState.from(
            api.post("/api/account/totp/enable", JSONObject().put("code", code.trim())),
        )

    suspend fun disableTotp(password: String, code: String): TotpState =
        TotpState.from(
            api.post(
                "/api/account/totp/disable",
                JSONObject().put("password", password).put("code", code.trim()),
            ),
        )

    /* ------------------------------- catálogo ------------------------------- */

    suspend fun listings(
        query: String = "",
        category: String = "Todos",
        language: String = "Todos",
        sort: String = "near",
        radius: Int = 0,
        page: Int = 1,
        tag: String = "",
    ): ListingPage = ListingPage.from(
        api.get(
            "/api/listings",
            mapOf(
                "q" to query,
                "category" to category,
                "language" to language,
                "sort" to sort,
                "radius" to radius.toString(),
                "page" to page.toString(),
                "tag" to tag,
            ),
        ),
    )

    suspend fun listing(id: String): ListingDetail =
        ListingDetail.from(api.get("/api/listings/${seg(id)}"))

    suspend fun setFavorite(id: String, favorite: Boolean) {
        api.post("/api/listings/${seg(id)}/favorite", JSONObject().put("favorite", favorite))
    }

    suspend fun requestListing(listingId: String) {
        api.post("/api/requests", JSONObject().put("listingId", listingId))
    }

    suspend fun shelf(filter: String, page: Int): ListingPage =
        ListingPage.from(api.get("/api/shelf", mapOf("shelf" to filter, "page" to page.toString())))

    suspend fun setListingStatus(id: String, status: String) {
        api.patch("/api/listings/${seg(id)}", JSONObject().put("status", status))
    }

    suspend fun removeListing(id: String) {
        api.delete("/api/listings/${seg(id)}")
    }

    suspend fun lookupIsbn(isbn: String): IsbnResult {
        val json = api.get("/api/isbn/${seg(isbn)}")
        val existing = json.optJSONObject("book")
        if (existing != null) {
            return IsbnResult(metadata = null, existingTitle = existing.optString("title"))
        }
        return IsbnResult(
            metadata = json.optJSONObject("metadata")?.let(IsbnMetadata::from),
            existingTitle = null,
        )
    }

    suspend fun createListing(
        title: String,
        author: String,
        category: String,
        condition: String,
        language: String,
        city: String,
        isbn: String?,
        tags: List<String>,
    ): Listing {
        val body = JSONObject()
            .put("title", title.trim())
            .put("author", author.trim())
            .put("category", category)
            .put("condition", condition)
            .put("language", language)
            .put("city", city.trim())
            .put("tags", org.json.JSONArray(tags))
        if (!isbn.isNullOrBlank()) body.put("isbn", isbn.trim())
        val json = api.post("/api/listings", body)
        return Listing.from(json.getJSONObject("listing"))
    }

    /* ------------------------------ intercambios ---------------------------- */

    suspend fun exchanges(): List<Exchange> =
        api.get("/api/requests").optJSONArray("requests")
            ?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) } }
            ?.map(Exchange::from)
            .orEmpty()

    suspend fun exchange(id: String): Exchange =
        Exchange.from(api.get("/api/requests/${seg(id)}").getJSONObject("request"))

    suspend fun updateExchange(id: String, status: String): Exchange =
        Exchange.from(
            api.patch("/api/requests/${seg(id)}", JSONObject().put("status", status))
                .getJSONObject("request"),
        )

    suspend fun markExchangeRead(id: String) {
        runCatching { api.post("/api/requests/${seg(id)}/read") }
    }

    suspend fun messages(id: String): MessagePage =
        MessagePage.from(api.get("/api/requests/${seg(id)}/messages"))

    suspend fun decrypt(requestId: String, page: MessagePage, userId: String): List<DecryptedMessage> {
        val identity = prefs.identity(identityScope(userId))?.let(MessageCrypto::restore)
        val peerKeys = page.keys.peerKeys
        return page.messages.map { message ->
            if (!message.encrypted) {
                return@map DecryptedMessage(message, message.body)
            }
            if (identity == null || peerKeys.isEmpty() || message.envelopes.isEmpty()) {
                return@map DecryptedMessage(message, null)
            }
            DecryptedMessage(message, decryptMessage(requestId, identity, peerKeys, message))
        }
    }

    /**
     * Prueba los sobres del mensaje.
     *
     * En un mensaje de la otra persona el sobre va dirigido a una clave mía y
     * se deriva con mi privada + la pública del remitente. En uno mío los
     * sobres van dirigidos a las claves del destinatario y se derivan con mi
     * privada + cada clave suya. Los mensajes heredados solo tienen un sobre y
     * se prueban con el primer candidato.
     */
    private fun decryptMessage(
        requestId: String,
        identity: MessageCrypto.Identity,
        peerKeys: List<KeyEntry>,
        message: Message,
    ): String? {
        val senderKey = peerKeys.firstOrNull { it.keyId == message.keyId }
        val candidates = buildList {
            if (!message.isMine && senderKey != null) {
                add(KeyEntry("peer", identity.keyId, senderKey.jwk))
            }
            addAll(peerKeys)
        }
        for (envelope in message.envelopes) {
            val candidate = candidates.firstOrNull { it.keyId == envelope.keyId }
                ?: message.envelopes.singleOrNull()?.let { candidates.firstOrNull() }
                ?: continue
            val aad = MessageCrypto.requestAad(
                requestId = requestId,
                senderId = message.senderId,
                keyId = message.keyId ?: identity.keyId,
            )
            val key = runCatching {
                MessageCrypto.conversationKey(identity, candidate.jwk, requestId)
            }.getOrNull() ?: continue
            val text = MessageCrypto.decrypt(key, envelope.ciphertext, envelope.iv, aad)
            if (text != null) return text
        }
        return null
    }

    suspend fun sendMessage(
        requestId: String,
        text: String,
        senderId: String,
        peerKeys: List<KeyEntry>,
    ): Message {
        val identity = prefs.identity(identityScope(senderId))?.let(MessageCrypto::restore)
            ?: throw ApiException(0, "encryptionUnavailable")
        if (peerKeys.isEmpty()) throw ApiException(0, "encryptionUnavailable")
        val aad = MessageCrypto.requestAad(requestId, senderId, identity.keyId)
        val envelopes = org.json.JSONArray()
        for (peerKey in peerKeys) {
            val key = MessageCrypto.conversationKey(identity, peerKey.jwk, requestId)
            val (ciphertext, iv) = MessageCrypto.encrypt(key, text, aad)
            envelopes.put(
                JSONObject()
                    .put("keyId", peerKey.keyId)
                    .put("ciphertext", ciphertext)
                    .put("iv", iv),
            )
        }
        val body = JSONObject()
            .put("keyId", identity.keyId)
            .put("envelopes", envelopes)
        return Message.from(
            api.post("/api/requests/${seg(requestId)}/messages", body)
                .getJSONObject("message"),
        )
    }

    suspend fun setHandoverMethod(id: String, method: String) {
        api.patch("/api/requests/${seg(id)}/handover", JSONObject().put("method", method))
    }

    suspend fun saveShipping(
        id: String,
        kind: String,
        postNumber: String,
        station: String,
        street: String,
        postalCode: String,
        city: String,
    ) {
        val body = JSONObject().put("kind", kind)
        if (kind == "packstation") {
            body.put("postNumber", postNumber).put("station", station)
        } else {
            body.put("street", street)
        }
        body.put("postalCode", postalCode).put("city", city)
        api.put("/api/requests/${seg(id)}/handover/shipping", body)
    }

    suspend fun verifyHandover(id: String, code: String): Exchange =
        Exchange.from(
            api.post("/api/requests/${seg(id)}/handover/verify", JSONObject().put("code", code.trim()))
                .getJSONObject("request"),
        )

    /* -------------------------------- avisos -------------------------------- */

    /** Avisos sin leer, para el distintivo de la campana. */
    suspend fun unreadNotifications(): Int =
        api.get("/api/notifications", mapOf("offset" to "0")).optInt("unread")

    suspend fun notifications(offset: Int): Pair<List<AppNotification>, Boolean> {
        val json = api.get("/api/notifications", mapOf("offset" to offset.toString()))
        val list = json.optJSONArray("notifications")
            ?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) } }
            ?.map(AppNotification::from)
            .orEmpty()
        return list to json.optBoolean("hasMore")
    }

    suspend fun markAllNotificationsRead() {
        api.post("/api/notifications/read")
    }

    suspend fun markNotificationRead(id: String) {
        api.patch("/api/notifications/${seg(id)}")
    }

    suspend fun deleteNotification(id: String) {
        api.delete("/api/notifications/${seg(id)}")
    }

    /* -------------------------------- clubes -------------------------------- */

    suspend fun clubs(query: String = "", city: String = "", page: Int = 1): Page<Club> {
        val params = mutableMapOf("page" to page.toString())
        if (query.isNotBlank()) params["q"] = query
        if (city.isNotBlank()) params["city"] = city
        val json = api.get("/api/clubs", params)
        return Page(json.objects("clubs").map(Club::from), json.bool("hasMore"))
    }

    suspend fun club(id: String): ClubBundle =
        ClubBundle.from(api.get("/api/clubs/${seg(id)}"))

    suspend fun joinClub(id: String, joined: Boolean) {
        api.post("/api/clubs/${seg(id)}/membership", JSONObject().put("joined", joined))
    }

    suspend fun postToClub(id: String, body: String) {
        api.post("/api/clubs/${seg(id)}/posts", JSONObject().put("body", body))
    }

    suspend fun votePoll(clubId: String, pollId: String, optionId: String) {
        api.post(
            "/api/clubs/${seg(clubId)}/polls/${seg(pollId)}/vote",
            JSONObject().put("optionId", optionId),
        )
    }

    suspend fun setAttendance(clubId: String, attending: Boolean) {
        api.post("/api/clubs/${seg(clubId)}/attendance", JSONObject().put("attending", attending))
    }

    suspend fun decideMembership(clubId: String, userId: String, approve: Boolean) {
        api.post(
            "/api/clubs/${seg(clubId)}/requests/${seg(userId)}",
            JSONObject().put("approve", approve),
        )
    }

    suspend fun community(scope: String, city: String = ""): Community {
        val params = mutableMapOf("scope" to scope)
        if (city.isNotBlank()) params["city"] = city
        return Community.from(api.get("/api/community", params))
    }

    /* -------------------------------- listas -------------------------------- */

    suspend fun myLists(): List<ReadingList> =
        api.get("/api/lists").optJSONArray("lists")
            ?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) } }
            ?.map(ReadingList::from)
            .orEmpty()

    suspend fun publicLists(query: String = "", page: Int = 1): Page<ReadingList> {
        val params = mutableMapOf("scope" to "public", "page" to page.toString())
        if (query.isNotBlank()) params["q"] = query
        val json = api.get("/api/lists", params)
        return Page(json.objects("lists").map(ReadingList::from), json.bool("hasMore"))
    }

    suspend fun listDetail(id: String): ReadingListDetail =
        ReadingListDetail.from(api.get("/api/lists/${seg(id)}").getJSONObject("list"))

    suspend fun createList(title: String, description: String, showOwner: Boolean): ReadingList {
        val body = JSONObject()
            .put("title", title.trim())
            .put("description", description.trim())
            .put("showOwner", showOwner)
        return ReadingList.from(api.post("/api/lists", body).getJSONObject("list"))
    }

    suspend fun addBookToList(listId: String, bookId: String) {
        api.post("/api/lists/${seg(listId)}/items", JSONObject().put("bookId", bookId))
    }

    suspend fun deleteList(id: String) {
        api.delete("/api/lists/${seg(id)}")
    }

    /* ----------------------------- cifrado (claves) ------------------------- */

    /** Identidad del dispositivo para una cuenta concreta, creándola si falta. */
    suspend fun ensureIdentity(userId: String): IdentityRecord {
        val scope = identityScope(userId)
        prefs.identity(scope)?.let { return it }
        adoptLegacyIdentity(scope)?.let { return it }
        val (identity, privateKey) = MessageCrypto.generateIdentity()
        prefs.saveIdentity(scope, identity.keyId, identity.publicJwk, privateKey)
        return prefs.identity(scope) ?: error("No se pudo guardar la identidad.")
    }

    /**
     * La identidad de la v0.1 no decía de qué cuenta era. Se adopta solo si el
     * servidor ya la tiene publicada en la ranura del móvil (es decir, si esa
     * cuenta es la que la publicó); en cualquier otro caso se descarta, porque
     * publicarla en otra cuenta entregaría la clave a quien no es.
     */
    private suspend fun adoptLegacyIdentity(scope: String): IdentityRecord? {
        val legacy = prefs.legacyIdentity() ?: return null
        val published = runCatching { serverKeyId("android") }.getOrNull()
        prefs.clearLegacyIdentity()
        if (published == null || published != legacy.keyId) return null
        prefs.saveIdentity(scope, legacy.keyId, legacy.publicJwk, legacy.privateKeyPkcs8)
        return prefs.identity(scope)
    }

    /** La identidad se guarda por servidor y cuenta: cambiar de servidor no la reutiliza. */
    private suspend fun identityScope(userId: String): String =
        "${prefs.serverUrl().trimEnd('/')}|$userId"

    /** Claves publicadas por la cuenta (ranuras web y app). */
    suspend fun serverKeys(): List<KeyEntry> {
        val json = api.get("/api/account/keys")
        val entries = json.objects("keys").mapNotNull(KeyEntry::from)
        if (entries.isNotEmpty()) return entries
        // Servidor anterior a la v40: una sola clave, que era la de la web.
        val keyId = json.textOrNull("keyId") ?: return emptyList()
        val jwk = json.obj("publicJwk") ?: return emptyList()
        return listOf(KeyEntry("web", keyId, jwk))
    }

    suspend fun serverKeyId(platform: String = "android"): String? =
        serverKeys().firstOrNull { it.platform == platform }?.keyId

    /**
     * Publica la clave pública de esta app. Cambiar una clave existente en la
     * ranura `android` exige la contraseña de la cuenta: una sesión robada no
     * basta. La clave del navegador (ranura `web`) no se toca.
     */
    suspend fun publishKey(userId: String, password: String?, platform: String = "android"): String {
        val identity = ensureIdentity(userId)
        val body = JSONObject(identity.publicJwk.toString())
        body.put("platform", platform)
        if (!password.isNullOrBlank()) body.put("password", password)
        val json = api.put("/api/account/keys", body)
        // La respuesta trae todas las ranuras; `keyId` suelto es el de la web
        // (compatibilidad), no necesariamente el que acabamos de publicar.
        val entries = json.objects("keys").mapNotNull(KeyEntry::from)
        return entries.firstOrNull { it.platform == platform }?.keyId
            ?: json.optString("keyId")
    }

    private fun seg(value: String): String = URLEncoder.encode(value, "UTF-8")
}
