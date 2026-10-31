# O script da página, em partes

O script da página é uma função só, `(function() { 'use strict'; … })();`, dividida aqui em arquivos que seguem as seções `// ===== X =====` do código. O build (`src/assemble.py`) junta os `*.js` desta pasta na ordem dos números, sem nada entre eles, num único `<script>`. Por isso nenhum arquivo é JavaScript válido sozinho: o `00` abre a função, o `19` a fecha, e todos compartilham as mesmas variáveis.

Onde os comentários (aqui e no `style.css`) dizem "app.js", leia "o script junto": era o arquivo único antes da divisão (31/10/2026).

Para criar um arquivo novo, dê a ele o número da posição em que deve entrar. Uma função pode ser usada antes do arquivo em que é definida, porque as declarações de função valem na função inteira. Já `const` e `let` só existem depois da linha em que são declaradas.
