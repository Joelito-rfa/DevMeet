/**
 * Mentions `@nom`.
 *
 * Le serveur ne fait jamais confiance à ce que le client prétend : on cherche
 * dans le texte les noms de membres **réels** de la communauté. Une mention
 * `@inconnu` reste du texte, elle ne crée ni notification ni droit particulier.
 *
 * L'analyse est volontairement stricte :
 *   - correspondance exacte du nom, insensible à la casse et aux accents ;
 *   - on retient le nom le plus long possible (« @Jean Dupont » n'est pas
 *     tronqué en « @Jean ») ;
 *   - le caractère qui suit doit être une fin de mot, sinon « @Jeanne » ne
 *     déclenche pas la mention de « Jean ».
 */

/** Caractères considérés comme « dans un mot » (lettres, chiffres, _ et -). */
const WORD_CHAR = /[\p{L}\p{N}_-]/u;

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * @param {string} content texte du message
 * @param {Array<{id: number, name: string}>} members membres de la communauté
 * @returns {Array<{id: number, name: string}>} mentions reconnues, sans doublon
 */
function parseMentions(content, members) {
  const text = String(content || "");

  if (!text.includes("@") || !Array.isArray(members) || members.length === 0) {
    return [];
  }

  // Du plus long au plus court : « Jean Dupont » doit gagner contre « Jean ».
  const candidates = members
    .filter((member) => member && member.name)
    .map((member) => ({
      id: Number(member.id),
      name: String(member.name),
      normalized: normalize(member.name),
    }))
    .sort((a, b) => b.normalized.length - a.normalized.length);

  const found = new Map();
  const normalizedText = normalize(text);

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@") {
      continue;
    }

    for (const candidate of candidates) {
      const start = index + 1;
      const end = start + candidate.name.length;

      if (end > text.length) {
        continue;
      }

      if (normalizedText.slice(start, end) !== candidate.normalized) {
        continue;
      }

      const after = text[end];

      if (after !== undefined && WORD_CHAR.test(after)) {
        continue;
      }

      found.set(candidate.id, { id: candidate.id, name: candidate.name });
      break;
    }
  }

  return [...found.values()];
}

module.exports = { parseMentions, normalize };
