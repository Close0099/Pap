// App Auth Helper - Verificar sessão da app mobile

import { db } from '../core/firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

export async function checkAppSession() {
    const sessionToken = localStorage.getItem('appUserToken');
    const userId = localStorage.getItem('appUserId');

    if (!sessionToken || !userId) {
        return null;
    }

    try {
        const userDoc = await getDoc(doc(db, 'users', userId));
        
        if (!userDoc.exists()) {
            clearAppSession();
            return null;
        }

        const userData = userDoc.data();

        // Verificar se a sessão é válida
        if (userData.appSessionToken !== sessionToken) {
            clearAppSession();
            return null;
        }

        // Verificar se a sessão não expirou
        let sessionExpiresAt = new Date();
        if (userData.appSessionExpiresAt) {
            if (userData.appSessionExpiresAt.seconds) {
                sessionExpiresAt = new Date(userData.appSessionExpiresAt.seconds * 1000);
            } else {
                sessionExpiresAt = new Date(userData.appSessionExpiresAt);
            }
        }

        if (new Date() > sessionExpiresAt) {
            clearAppSession();
            return null;
        }

        // Verificar se o utilizador não está bloqueado
        if (userData.isBlocked === true) {
            clearAppSession();
            return null;
        }

        return {
            id: userId,
            ...userData
        };

    } catch (error) {
        console.error('Erro ao verificar sessão da app:', error);
        clearAppSession();
        return null;
    }
}

export function clearAppSession() {
    localStorage.removeItem('appUserToken');
    localStorage.removeItem('appUserId');
    localStorage.removeItem('appUserEmail');
    localStorage.removeItem('appUserName');
}

export function getAppUserId() {
    return localStorage.getItem('appUserId');
}

export function getAppUserEmail() {
    return localStorage.getItem('appUserEmail');
}

export function getAppUserName() {
    return localStorage.getItem('appUserName');
}

export function getAppSessionToken() {
    return localStorage.getItem('appUserToken');
}
