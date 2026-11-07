package org.wanderbibliothek.app.data

import org.json.JSONObject

internal fun JSONObject.text(key: String, fallback: String = ""): String {
    val value = opt(key) ?: return fallback
    if (value == JSONObject.NULL) return fallback
    return value.toString()
}

internal fun JSONObject.textOrNull(key: String): String? {
    val value = opt(key) ?: return null
    if (value == JSONObject.NULL) return null
    return value.toString().takeIf { it.isNotEmpty() }
}

internal fun JSONObject.obj(key: String): JSONObject? = optJSONObject(key)

internal fun JSONObject.objects(key: String): List<JSONObject> {
    val array = optJSONArray(key) ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}

internal fun JSONObject.strings(key: String): List<String> {
    val array = optJSONArray(key) ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.opt(it)?.toString() }
}

internal fun JSONObject.bool(key: String): Boolean = optBoolean(key, false)

internal fun JSONObject.int(key: String): Int = optInt(key, 0)

internal fun JSONObject.decimalOrNull(key: String): Double? {
    val value = opt(key) ?: return null
    if (value == JSONObject.NULL) return null
    return (value as? Number)?.toDouble()
}

data class User(
    val id: String,
    val name: String,
    val email: String,
    val city: String,
    val bio: String,
    val isAdmin: Boolean,
    val emailVerified: Boolean,
    val emailNotifications: Boolean,
    val locale: String,
) {
    companion object {
        fun from(json: JSONObject) = User(
            id = json.text("id"),
            name = json.text("name"),
            email = json.text("email"),
            city = json.text("city"),
            bio = json.text("bio"),
            isAdmin = json.bool("isAdmin"),
            emailVerified = json.bool("emailVerified"),
            emailNotifications = json.bool("emailNotifications"),
            locale = json.text("locale", "de"),
        )
    }
}

data class TotpState(val enabled: Boolean, val pending: Boolean) {
    companion object {
        fun from(json: JSONObject) = TotpState(
            enabled = json.bool("enabled"),
            pending = json.bool("pending"),
        )
    }
}

data class TotpSetup(
    val secret: String,
    val otpauthUrl: String,
    val qrDataUrl: String?,
) {
    companion object {
        fun from(json: JSONObject) = TotpSetup(
            secret = json.text("secret"),
            otpauthUrl = json.text("otpauthUrl"),
            qrDataUrl = json.textOrNull("qrDataUrl"),
        )
    }
}

data class Listing(
    val id: String,
    val bookId: String,
    val title: String,
    val author: String,
    val isbn: String?,
    val category: String,
    val language: String,
    val condition: String,
    val city: String,
    val distanceKm: Double?,
    val coverUrl: String?,
    val status: String,
    val notes: String,
    val ownerId: String,
    val ownerName: String,
    val tags: List<String>,
    val isMine: Boolean,
    val isFavorite: Boolean,
    val myRequestStatus: String?,
    val publisher: String?,
    val year: String?,
    val series: String?,
) {
    companion object {
        fun from(json: JSONObject): Listing {
            val owner = json.obj("owner")
            return Listing(
                id = json.text("id"),
                bookId = json.text("bookId"),
                title = json.text("title"),
                author = json.text("author"),
                isbn = json.textOrNull("isbn"),
                category = json.text("category"),
                language = json.text("language"),
                condition = json.text("condition"),
                city = json.text("city"),
                distanceKm = json.decimalOrNull("distanceKm"),
                coverUrl = json.textOrNull("coverUrl"),
                status = json.text("status", "available"),
                notes = json.text("notes"),
                ownerId = owner?.text("id").orEmpty(),
                ownerName = owner?.text("name").orEmpty(),
                tags = json.strings("tags"),
                isMine = json.bool("isMine"),
                isFavorite = json.bool("isFavorite"),
                myRequestStatus = json.textOrNull("myRequestStatus"),
                publisher = json.textOrNull("publisher"),
                year = json.textOrNull("year"),
                series = json.textOrNull("series"),
            )
        }
    }
}

/** Página de una lista paginada del servidor (`hasMore` + elementos). */
data class Page<T>(val items: List<T>, val hasMore: Boolean)

data class ListingPage(
    val items: List<Listing>,
    val total: Int,
    val page: Int,
    val hasMore: Boolean,
) {
    companion object {
        fun from(json: JSONObject) = ListingPage(
            items = json.objects("items").map(Listing::from),
            total = json.int("total"),
            page = json.int("page").coerceAtLeast(1),
            hasMore = json.bool("hasMore"),
        )
    }
}

data class ListingDetail(val listing: Listing, val similar: List<Listing>) {
    companion object {
        fun from(json: JSONObject) = ListingDetail(
            listing = Listing.from(json.getJSONObject("listing")),
            similar = json.objects("similar").map(Listing::from),
        )
    }
}

data class PersonRef(val id: String, val name: String, val city: String)

data class Shipping(
    val kind: String,
    val postNumber: String,
    val station: String,
    val street: String,
    val postalCode: String,
    val city: String,
) {
    companion object {
        fun from(json: JSONObject) = Shipping(
            kind = json.text("kind"),
            postNumber = json.text("postNumber"),
            station = json.text("station"),
            street = json.text("street"),
            postalCode = json.text("postalCode"),
            city = json.text("city"),
        )
    }
}

data class Exchange(
    val id: String,
    val status: String,
    val role: String,
    val createdAt: String,
    val updatedAt: String,
    val listingId: String,
    val title: String,
    val author: String,
    val coverUrl: String?,
    val requester: PersonRef,
    val owner: PersonRef,
    val messageCount: Int,
    val unreadMessages: Int,
    val confirmedByMe: Boolean,
    val confirmedByOther: Boolean,
    val method: String,
    val shipping: Shipping?,
) {
    val peer: PersonRef get() = if (role == "requester") owner else requester
    val isDelivering: Boolean get() = role == "owner"

    companion object {
        fun from(json: JSONObject): Exchange {
            val listing = json.obj("listing")
            val delivery = json.obj("delivery")
            return Exchange(
                id = json.text("id"),
                status = json.text("status"),
                role = json.text("role"),
                createdAt = json.text("createdAt"),
                updatedAt = json.text("updatedAt"),
                listingId = listing?.text("id").orEmpty(),
                title = listing?.text("title").orEmpty(),
                author = listing?.text("author").orEmpty(),
                coverUrl = listing?.textOrNull("coverUrl"),
                requester = json.obj("requester")?.let {
                    PersonRef(it.text("id"), it.text("name"), it.text("city"))
                } ?: PersonRef("", "", ""),
                owner = json.obj("owner")?.let {
                    PersonRef(it.text("id"), it.text("name"), it.text("city"))
                } ?: PersonRef("", "", ""),
                messageCount = json.int("messageCount"),
                unreadMessages = json.int("unreadMessages"),
                confirmedByMe = json.bool("confirmedByMe"),
                confirmedByOther = json.bool("confirmedByOther"),
                method = delivery?.text("method", "in_person") ?: "in_person",
                shipping = delivery?.obj("shipping")?.let(Shipping::from),
            )
        }
    }
}

/** Sobre cifrado para una clave concreta del destinatario. */
data class MessageEnvelope(
    val keyId: String,
    val ciphertext: String,
    val iv: String,
)

/** Clave pública publicada por un dispositivo (web o app). */
data class KeyEntry(
    val platform: String,
    val keyId: String,
    val jwk: JSONObject,
) {
    companion object {
        fun from(json: JSONObject): KeyEntry? {
            val keyId = json.textOrNull("keyId") ?: return null
            val jwk = json.obj("publicJwk") ?: return null
            return KeyEntry(json.text("platform", "web"), keyId, jwk)
        }
    }
}

data class Message(
    val id: String,
    val body: String,
    val ciphertext: String?,
    val iv: String?,
    val keyId: String?,
    val encrypted: Boolean,
    val createdAt: String,
    val senderId: String,
    val senderName: String,
    val isMine: Boolean,
    val envelopes: List<MessageEnvelope>,
) {
    companion object {
        fun from(json: JSONObject): Message {
            val sender = json.obj("sender")
            val ciphertext = json.textOrNull("ciphertext")
            val iv = json.textOrNull("iv")
            val keyId = json.textOrNull("keyId")
            val envelopes = json.objects("envelopes").mapNotNull { envelope ->
                val envelopeKeyId = envelope.textOrNull("keyId") ?: return@mapNotNull null
                val body = envelope.textOrNull("ciphertext") ?: return@mapNotNull null
                val envelopeIv = envelope.textOrNull("iv") ?: return@mapNotNull null
                MessageEnvelope(envelopeKeyId, body, envelopeIv)
            }.ifEmpty {
                // Mensajes anteriores a la v40: un solo sobre y sin destinatario.
                if (ciphertext != null && iv != null) {
                    listOf(MessageEnvelope(keyId ?: "", ciphertext, iv))
                } else {
                    emptyList()
                }
            }
            return Message(
                id = json.text("id"),
                body = json.text("body"),
                ciphertext = ciphertext,
                iv = iv,
                keyId = keyId,
                encrypted = json.bool("encrypted"),
                createdAt = json.text("createdAt"),
                senderId = sender?.text("id").orEmpty(),
                senderName = sender?.text("name").orEmpty(),
                isMine = json.bool("isMine"),
                envelopes = envelopes,
            )
        }
    }
}

data class ConversationKeys(
    val myKeyId: String?,
    val myKeys: List<KeyEntry>,
    val peerKeys: List<KeyEntry>,
)

data class MessagePage(
    val messages: List<Message>,
    val hasMore: Boolean,
    val keys: ConversationKeys,
) {
    companion object {
        fun from(json: JSONObject): MessagePage {
            val keys = json.obj("keys")
            val me = keys?.obj("me")
            val peer = keys?.obj("peer")
            return MessagePage(
                messages = json.objects("messages").map(Message::from),
                hasMore = json.bool("hasMore"),
                keys = ConversationKeys(
                    myKeyId = me?.textOrNull("keyId"),
                    myKeys = keyEntries(me),
                    peerKeys = keyEntries(peer),
                ),
            )
        }

        /** Las dos ranuras o, con un servidor anterior, la única clave. */
        private fun keyEntries(side: JSONObject?): List<KeyEntry> {
            if (side == null) return emptyList()
            val entries = side.objects("keys").mapNotNull(KeyEntry::from)
            if (entries.isNotEmpty()) return entries
            val keyId = side.textOrNull("keyId") ?: return emptyList()
            val jwk = side.obj("publicJwk") ?: return emptyList()
            return listOf(KeyEntry("web", keyId, jwk))
        }
    }
}

data class AppNotification(
    val id: String,
    val type: String,
    val title: String,
    val body: String,
    val link: String?,
    val requestId: String?,
    val listingId: String?,
    val readAt: String?,
    val createdAt: String,
) {
    companion object {
        fun from(json: JSONObject) = AppNotification(
            id = json.text("id"),
            type = json.text("type"),
            title = json.text("title"),
            body = json.text("body"),
            link = json.textOrNull("link"),
            requestId = json.textOrNull("requestId"),
            listingId = json.textOrNull("listingId"),
            readAt = json.textOrNull("readAt"),
            createdAt = json.text("createdAt"),
        )
    }
}

data class Club(
    val id: String,
    val name: String,
    val city: String,
    val description: String,
    val meetsOn: String,
    val meetsAt: String,
    val meetsPlace: String,
    val meetsLink: String,
    val bookId: String?,
    val bookTitle: String?,
    val bookAuthor: String?,
    val members: Int,
    val isMember: Boolean,
    val isMine: Boolean,
    val ownerName: String,
    val joinPolicy: String,
    val myStatus: String,
    val isModerator: Boolean,
    val progress: Int,
    val attendees: Int,
    val attending: Boolean,
    val pendingRequests: Int,
) {
    companion object {
        fun from(json: JSONObject): Club {
            val book = json.obj("book")
            return Club(
                id = json.text("id"),
                name = json.text("name"),
                city = json.text("city"),
                description = json.text("description"),
                meetsOn = json.text("meetsOn"),
                meetsAt = json.text("meetsAt"),
                meetsPlace = json.text("meetsPlace"),
                meetsLink = json.text("meetsLink"),
                bookId = book?.textOrNull("id"),
                bookTitle = book?.textOrNull("title"),
                bookAuthor = book?.textOrNull("author"),
                members = json.int("members"),
                isMember = json.bool("isMember"),
                isMine = json.bool("isMine"),
                ownerName = json.obj("owner")?.text("name").orEmpty(),
                joinPolicy = json.text("joinPolicy", "open"),
                myStatus = json.text("myStatus", "none"),
                isModerator = json.bool("isModerator"),
                progress = json.int("progress"),
                attendees = json.int("attendees"),
                attending = json.bool("attending"),
                pendingRequests = json.int("pendingRequests"),
            )
        }
    }
}

data class ClubMember(val id: String, val name: String, val city: String)

data class ClubPost(
    val id: String,
    val body: String,
    val createdAt: String,
    val authorName: String,
    val likes: Int,
    val likedByMe: Boolean,
    val isMine: Boolean,
    val deleted: Boolean,
    val replies: List<ClubPost>,
) {
    companion object {
        fun from(json: JSONObject): ClubPost = ClubPost(
            id = json.text("id"),
            body = json.text("body"),
            createdAt = json.text("createdAt"),
            authorName = json.obj("author")?.text("name").orEmpty(),
            likes = json.int("likes"),
            likedByMe = json.bool("likedByMe"),
            isMine = json.bool("isMine"),
            deleted = json.bool("deleted"),
            replies = json.objects("replies").map { ClubPost.from(it) },
        )
    }
}

data class PollOption(
    val id: String,
    val title: String,
    val author: String,
    val votes: Int,
)

data class Poll(
    val id: String,
    val question: String,
    val closed: Boolean,
    val totalVotes: Int,
    val votedOptionId: String?,
    val options: List<PollOption>,
) {
    companion object {
        fun from(json: JSONObject) = Poll(
            id = json.text("id"),
            question = json.text("question"),
            closed = json.bool("closed"),
            totalVotes = json.int("totalVotes"),
            votedOptionId = json.textOrNull("votedOptionId"),
            options = json.objects("options").map { option ->
                PollOption(
                    id = option.text("id"),
                    title = option.obj("book")?.text("title").orEmpty(),
                    author = option.obj("book")?.text("author").orEmpty(),
                    votes = option.int("votes"),
                )
            },
        )
    }
}

data class MembershipRequest(val userId: String, val name: String, val city: String) {
    companion object {
        fun from(json: JSONObject): MembershipRequest {
            val user = json.obj("user")
            return MembershipRequest(
                userId = user?.text("id").orEmpty(),
                name = user?.text("name").orEmpty(),
                city = user?.text("city").orEmpty(),
            )
        }
    }
}

data class ClubBundle(
    val club: Club,
    val members: List<ClubMember>,
    val posts: List<ClubPost>,
    val poll: Poll?,
    val requests: List<MembershipRequest>,
) {
    companion object {
        fun from(json: JSONObject) = ClubBundle(
            club = Club.from(json.getJSONObject("club")),
            members = json.objects("members").map {
                ClubMember(it.text("id"), it.text("name"), it.text("city"))
            },
            posts = json.obj("posts")?.objects("posts")?.map(ClubPost::from).orEmpty(),
            poll = json.obj("poll")?.let(Poll::from),
            requests = json.objects("requests").map(MembershipRequest::from),
        )
    }
}

data class ReadingList(
    val id: String,
    val title: String,
    val description: String,
    val items: Int,
    val ownerName: String,
    val isMine: Boolean,
    val showOwner: Boolean,
) {
    companion object {
        fun from(json: JSONObject) = ReadingList(
            id = json.text("id"),
            title = json.text("title"),
            description = json.text("description"),
            items = json.int("items"),
            ownerName = json.obj("owner")?.text("name").orEmpty(),
            isMine = json.bool("isMine"),
            showOwner = json.bool("showOwner"),
        )
    }
}

data class ListBook(
    val bookId: String,
    val title: String,
    val author: String,
    val coverUrl: String?,
    val note: String,
)

data class ReadingListDetail(
    val list: ReadingList,
    val books: List<ListBook>,
) {
    companion object {
        fun from(json: JSONObject): ReadingListDetail {
            val list = ReadingList.from(json)
            return ReadingListDetail(
                list = list,
                books = json.objects("books").map {
                    ListBook(
                        bookId = it.text("bookId"),
                        title = it.text("title"),
                        author = it.text("author"),
                        coverUrl = it.textOrNull("coverUrl"),
                        note = it.text("note"),
                    )
                },
            )
        }
    }
}

data class Reader(
    val id: String,
    val name: String,
    val city: String,
    val published: Int,
    val followers: Int,
    val isFollowing: Boolean,
    val isMe: Boolean,
    val distanceKm: Double?,
    val sharedBooks: Int,
) {
    companion object {
        fun from(json: JSONObject): Reader {
            val user = json.obj("user")
            return Reader(
                id = user?.text("id").orEmpty(),
                name = user?.text("name").orEmpty(),
                city = user?.text("city").orEmpty(),
                published = json.int("published"),
                followers = json.int("followers"),
                isFollowing = json.bool("isFollowing"),
                isMe = json.bool("isMe"),
                distanceKm = json.decimalOrNull("distanceKm"),
                sharedBooks = json.int("sharedBooks"),
            )
        }
    }
}

data class ActivityItem(
    val id: String,
    val type: String,
    val actor: String,
    val title: String,
    val listingId: String,
    val createdAt: String,
) {
    companion object {
        fun from(json: JSONObject) = ActivityItem(
            id = json.text("id"),
            type = json.text("type"),
            actor = json.text("actor"),
            title = json.text("title"),
            listingId = json.text("listingId"),
            createdAt = json.text("createdAt"),
        )
    }
}

data class Conversation(
    val id: String,
    val bookTitle: String,
    val excerpt: String,
    val replies: Int,
    val likes: Int,
    val authorName: String,
    val createdAt: String,
) {
    companion object {
        fun from(json: JSONObject) = Conversation(
            id = json.text("id"),
            bookTitle = json.text("bookTitle"),
            excerpt = json.text("excerpt"),
            replies = json.int("replies"),
            likes = json.int("likes"),
            authorName = json.obj("author")?.text("name").orEmpty(),
            createdAt = json.text("createdAt"),
        )
    }
}

data class Stats(
    val available: Int,
    val members: Int,
    val completed: Int,
    val clubs: Int,
    val titles: Int,
) {
    companion object {
        fun from(json: JSONObject) = Stats(
            available = json.int("available"),
            members = json.int("members"),
            completed = json.int("completed"),
            clubs = json.int("clubs"),
            titles = json.int("titles"),
        )
    }
}

data class Community(
    val activity: List<ActivityItem>,
    val conversations: List<Conversation>,
    val clubs: List<Club>,
    val readers: List<Reader>,
    val lists: List<ReadingList>,
    val stats: Stats,
) {
    companion object {
        fun from(json: JSONObject) = Community(
            activity = json.objects("activity").map(ActivityItem::from),
            conversations = json.objects("conversations").map(Conversation::from),
            clubs = json.obj("clubs")?.objects("clubs")?.map(Club::from).orEmpty(),
            readers = json.obj("readers")?.objects("readers")?.map(Reader::from).orEmpty(),
            lists = json.obj("lists")?.objects("lists")?.map(ReadingList::from).orEmpty(),
            stats = json.obj("stats")?.let(Stats::from) ?: Stats(0, 0, 0, 0, 0),
        )
    }
}

/** Datos deducidos por el servidor a partir de un ISBN. */
data class IsbnMetadata(
    val title: String,
    val author: String,
    val language: String?,
    val category: String?,
    val tags: List<String>,
    val publisher: String?,
    val year: String?,
    val series: String?,
) {
    companion object {
        fun from(json: JSONObject): IsbnMetadata? {
            if (!json.has("title") || json.isNull("title")) return null
            return IsbnMetadata(
                title = json.text("title"),
                author = json.strings("authors").joinToString(", "),
                language = json.textOrNull("language"),
                category = json.textOrNull("category"),
                tags = json.strings("tags"),
                publisher = json.textOrNull("publisher"),
                year = json.textOrNull("year"),
                series = json.textOrNull("series"),
            )
        }
    }
}
