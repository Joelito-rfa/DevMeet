const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const multer = require("multer");

const config = require("../config");
const attachmentsService = require("../services/attachments");
const { badRequest, notFound, forbidden } = require("../utils/errors");
/**
 * Dépôt et retrait de pièces jointes.
 *
 * Les octets sont écrits sur le disque, les métadonnées en base. Le fichier est
 * stocké sous un nom aléatoire (`storage_key`) : le nom d'origine reste en base
 * mais n'est jamais utilisé comme chemin, ce qui évite toute traversée de
 * répertoire (`../../`).
 */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxSizeBytes, files: 1 },
});

/** Extensions sûres déduites du type MIME (jamais du nom fourni). */
const EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/zip": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
};

/** Middleware multer qui traduit ses erreurs en réponses HTTP lisibles. */
function singleFile(fieldName = "file") {
  const handler = upload.single(fieldName);

  return (req, res, next) => {
    handler(req, res, (error) => {
      if (!error) {
        return next();
      }

      if (error.code === "LIMIT_FILE_SIZE") {
        return next(
          badRequest(
            `Fichier trop volumineux (maximum ${Math.round(
              config.uploads.maxSizeBytes / (1024 * 1024)
            )} Mo).`,
            "file_too_large"
          )
        );
      }

      return next(badRequest("Envoi de fichier invalide.", "upload_failed"));
    });
  };
}

/**
 * Nom de fichier présentable, débarrassé de tout chemin et caractère de contrôle.
 *
 * Busboy (utilisé par multer) décode `filename` en latin1 : un nom accentué
 * arrive donc sous forme d'octets mal réinterprétés (« Ã©cran » au lieu de
 * « écran »). On retente la lecture en UTF-8, et on ne garde le résultat que
 * s'il est cohérent.
 */
function decodeFileName(raw) {
  const value = String(raw ?? "");
  const converted = Buffer.from(value, "latin1").toString("utf8");

  return converted.includes("\uFFFD") ? value : converted;
}

function safeDisplayName(originalName) {
  const base = path.basename(decodeFileName(originalName) || "fichier");

  return (
    base
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/]/g, "-")
      .slice(0, 180) || "fichier"
  );
}

async function ensureUploadDir() {
  await fs.mkdir(config.uploads.dir, { recursive: true });
}

/**
 * Enregistre un fichier déjà reçu en mémoire.
 * @returns {Promise<object>} la pièce jointe créée
 */
async function storeFile({ file, channelId, uploaderId }) {
  const mimeType = String(file.mimetype || "").toLowerCase();

  if (!config.uploads.allowedMimeTypes.includes(mimeType)) {
    throw badRequest(
      `Type de fichier refusé (${mimeType || "inconnu"}). Types acceptés : images, PDF, texte, CSV, ZIP et documents bureautiques.`,
      "file_type_not_allowed"
    );
  }

  if (!file.size) {
    throw badRequest("Fichier vide.", "empty_file");
  }

  const extension = EXTENSIONS[mimeType] || ".bin";
  const storageKey = `${crypto.randomBytes(24).toString("hex")}${extension}`;

  await ensureUploadDir();
  await fs.writeFile(path.join(config.uploads.dir, storageKey), file.buffer);

  return attachmentsService.create({
    channelId,
    uploaderId,
    fileName: safeDisplayName(file.originalname),
    storageKey,
    mimeType,
    size: file.size,
  });
}

/**
 * Chemin disque d'une pièce jointe, en s'assurant que le chemin calculé reste
 * bien dans le dossier d'uploads (défense en profondeur).
 */
function resolveStoragePath(attachment) {
  const resolved = path.resolve(config.uploads.dir, attachment.storage_key);
  const root = path.resolve(config.uploads.dir);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw forbidden("Chemin de fichier invalide.", "invalid_storage_path");
  }

  return resolved;
}

/** Envoi du fichier au client (route authentifiée). */
async function sendFile(res, attachment) {
  const filePath = resolveStoragePath(attachment);

  try {
    await fs.access(filePath);
  } catch {
    throw notFound("Fichier introuvable sur le disque.", "file_missing");
  }

  res.setHeader("Content-Type", attachment.mime_type);
  // `attachment` force le téléchargement : un fichier déposé ne s'exécute jamais
  // dans le contexte de l'application.
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`
  );

  return res.sendFile(filePath);
}

module.exports = { singleFile, storeFile, sendFile, safeDisplayName };
