package com.example.templateandroid.ui.screens

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ComponentsScreenTest {
    @Test
    fun submittedNameTrimsSurroundingWhitespace() {
        assertEquals("Ada Lovelace", submittedNameOrNull("  Ada Lovelace  "))
    }

    @Test
    fun submittedNameRejectsBlankInput() {
        assertNull(submittedNameOrNull(" \t\n "))
    }
}