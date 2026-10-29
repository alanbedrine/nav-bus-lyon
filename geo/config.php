<?php
// Réglages du filtre. Fichier à adapter sur l'hébergement.
return [
    // Adresses IP toujours autorisées (par exemple la vôtre pour tester depuis l'étranger).
    'allow_ips' => [],
    // À mettre à true UNIQUEMENT si l'hébergeur place l'IP réelle du visiteur dans X-Forwarded-For (à vérifier avec geo-test.php).
    'trust_forwarded_for' => false,
];
