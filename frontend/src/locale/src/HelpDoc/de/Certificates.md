## Hilfe zu Zertifikaten

### HTTP-Zertifikat

Ein HTTP-validiertes Zertifikat bedeutet, dass die Let's Encrypt-Server versuchen,
deine Domains über HTTP (nicht HTTPS!) zu erreichen und bei Erfolg dein Zertifikat
ausstellen.

Für diese Methode musst du einen _Proxy Host_ für deine Domain(s) erstellen, der über
HTTP erreichbar ist und auf diese Nginx-Installation zeigt. Nachdem ein Zertifikat
ausgestellt wurde, kannst du den _Proxy Host_ so anpassen, dass er dieses Zertifikat
auch für HTTPS-Verbindungen nutzt. Der _Proxy Host_ muss jedoch weiterhin für HTTP-
Zugriff konfiguriert sein, damit das Zertifikat erneuert werden kann.

Dieser Prozess unterstützt _keine_ Wildcard-Domains.

### DNS-Zertifikat

Ein DNS-validiertes Zertifikat erfordert ein DNS-Provider-Plugin. Dieser DNS-Provider
wird verwendet, um temporäre Einträge in deiner Domain zu erstellen, und Let's Encrypt
fragt diese Einträge ab, um sicherzustellen, dass du der Eigentümer bist. Bei Erfolg
wird dein Zertifikat ausgestellt.

Du musst vor dem Anfordern dieses Zertifikatstyps keinen _Proxy Host_ anlegen. Ebenso
musst du deinen _Proxy Host_ nicht für HTTP-Zugriff konfigurieren.

Dieser Prozess unterstützt _Wildcard-Domains_.

### Benutzerdefiniertes Zertifikat

Nutze diese Option, um dein eigenes SSL-Zertifikat hochzuladen, wie es von deiner
Zertifizierungsstelle bereitgestellt wird.
