import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, FileText, GripVertical, LogOut, Pencil, Plus, Trash2, Upload, X } from "lucide-react";

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "include",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error(import.meta.env.DEV
      ? "API locale injoignable. Lance npm run backend:dev dans un autre terminal et vérifie le fichier .env."
      : "API momentanément indisponible. Le serveur peut être en train de démarrer, réessaie dans quelques instants.");
  }

  const body = await response.text();
  let result = {};
  try {
    result = body ? JSON.parse(body) : {};
  } catch {
    if (!response.ok && import.meta.env.DEV && response.status >= 500) {
      throw new Error("API locale injoignable. Lance npm run backend:dev dans un autre terminal.");
    }
  }
  if (!response.ok) {
    const error = new Error(result.error ?? result.message ?? `Erreur API (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function Feedback({ message, error }) {
  if (!message) return null;
  return <p className={`form-message ${error ? "form-error" : "form-success"}`}>{message}</p>;
}

function DragHandle({ label, onPointerDown, onKeyDown }) {
  return (
    <button
      className="drag-handle"
      type="button"
      aria-label={`Réorganiser ${label}`}
      title="Glisser pour déplacer · flèches du clavier pour réorganiser"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <GripVertical size={18} />
    </button>
  );
}

function SkillRating({ value }) {
  return (
    <span className="skill-rating" role="img" aria-label={`${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((point) => (
        <span className={point <= value ? "skill-rating-point is-filled" : "skill-rating-point"} key={point} />
      ))}
    </span>
  );
}

function PhotoPicker({ url, publicId, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file) {
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Choisis un fichier image.");
      return;
    }
    if (file.size > 5_000_000) {
      setError("L’image ne doit pas dépasser 5 Mo.");
      return;
    }

    setBusy(true);
    try {
      if (import.meta.env.DEV) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => resolve(reader.result), { once: true });
          reader.addEventListener("error", () => reject(new Error("La lecture de l’image a échoué.")), { once: true });
          reader.readAsDataURL(file);
        });
        const result = await api("/api/admin/upload-local", {
          method: "POST",
          body: JSON.stringify({ dataUrl }),
        });
        onChange({ url: result.url, publicId: result.publicId });
        return;
      }

      const signature = await api("/api/admin/upload-signature", { method: "POST" });
      const payload = new FormData();
      payload.append("file", file);
      payload.append("api_key", signature.apiKey);
      payload.append("timestamp", String(signature.timestamp));
      payload.append("signature", signature.signature);
      payload.append("folder", signature.folder);
      payload.append("allowed_formats", signature.allowed_formats);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`,
        { method: "POST", body: payload },
      );
      const result = await response.json();
      if (!response.ok || !result.secure_url || !result.public_id) {
        throw new Error(result.error?.message ?? "Cloudinary n’a pas pu recevoir l’image.");
      }
      onChange({ url: result.secure_url, publicId: result.public_id });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "L’envoi de l’image a échoué.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="photo-field">
      <div className="photo-preview">
        {url ? <img src={url} alt="Aperçu" /> : <span>Photo</span>}
      </div>
      <div className="photo-controls">
        <label className="button button-muted upload-button">
          {busy ? "Envoi…" : url ? "Changer la photo" : "Téléverser une photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {url && (
          <button className="text-button" type="button" onClick={() => onChange({ url: "", publicId: "" })}>
            Retirer
          </button>
        )}
        <Feedback message={error} error />
      </div>
    </div>
  );
}

function CvPicker({ url, fileName, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file) {
    setError("");
    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choisis un fichier PDF.");
      return;
    }
    if (file.size > 10_000_000) {
      setError("Le CV ne doit pas dépasser 10 Mo.");
      return;
    }

    setBusy(true);
    try {
      const safeName = `${file.name
        .replace(/[\\/]/g, "_")
        .replace(/[^\p{L}\p{N}._ -]/gu, "_")
        .replace(/\.pdf$/i, "")
        .trim()
        .slice(0, 115) || "CV"}.pdf`;

      if (import.meta.env.DEV) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => {
            const base64 = String(reader.result).split(",")[1];
            resolve(`data:application/pdf;base64,${base64}`);
          }, { once: true });
          reader.addEventListener("error", () => reject(new Error("La lecture du CV a échoué.")), { once: true });
          reader.readAsDataURL(file);
        });
        const result = await api("/api/admin/upload-cv-local", {
          method: "POST",
          body: JSON.stringify({ dataUrl, fileName: safeName }),
        });
        onChange({ url: result.url, fileName: result.fileName });
        return;
      }

      const signature = await api("/api/admin/upload-signature", {
        method: "POST",
        body: JSON.stringify({ assetType: "cv" }),
      });
      const payload = new FormData();
      payload.append("file", file);
      payload.append("api_key", signature.apiKey);
      payload.append("timestamp", String(signature.timestamp));
      payload.append("signature", signature.signature);
      payload.append("folder", signature.folder);
      payload.append("allowed_formats", signature.allowed_formats);

      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${signature.cloudName}/${signature.resourceType}/upload`,
        { method: "POST", body: payload },
      );
      const result = await response.json();
      if (!response.ok || !result.secure_url) {
        throw new Error(result.error?.message ?? "Cloudinary n’a pas pu recevoir le CV.");
      }
      onChange({ url: result.secure_url, fileName: safeName });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "L’envoi du CV a échoué.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cv-picker">
      <div className="cv-file-info">
        <FileText size={22} aria-hidden="true" />
        <span>{url ? fileName || "CV.pdf" : "Aucun CV ajouté"}</span>
      </div>
      <div className="cv-controls">
        <label className="button button-muted upload-button">
          <Upload size={15} /> {busy ? "Envoi…" : url ? "Remplacer le CV" : "Importer un CV"}
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        {url && (
          <button
            className="text-button cv-remove"
            type="button"
            onClick={() => onChange({ url: "", fileName: "" })}
          >
            <X size={14} /> Retirer
          </button>
        )}
      </div>
      <p className="cv-help">PDF uniquement, 10 Mo maximum. Enregistre le profil après l’import.</p>
      <Feedback message={error} error />
    </div>
  );
}

const blankSkill = { name: "", category: "", level: 3, imageUrl: "", imagePublicId: "" };
const blankProject = { title: "", description: "", imageUrl: "", imagePublicId: "", link: "", tags: "" };
const blankExperience = {
  role: "",
  company: "",
  location: "",
  startDate: "",
  endDate: "",
  description: "",
  imageUrl: "",
  imagePublicId: "",
};
const blankEducation = {
  degree: "",
  institution: "",
  location: "",
  startDate: "",
  endDate: "",
  description: "",
  imageUrl: "",
  imagePublicId: "",
};
const blankHobby = { title: "", description: "", imageUrl: "", imagePublicId: "" };

export default function Admin() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [data, setData] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [apiError, setApiError] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState(false);
  const [skill, setSkill] = useState(blankSkill);
  const [skillId, setSkillId] = useState("");
  const [skillMessage, setSkillMessage] = useState("");
  const [skillError, setSkillError] = useState(false);
  const [project, setProject] = useState(blankProject);
  const [projectId, setProjectId] = useState("");
  const [projectMessage, setProjectMessage] = useState("");
  const [projectError, setProjectError] = useState(false);
  const [experience, setExperience] = useState(blankExperience);
  const [experienceId, setExperienceId] = useState("");
  const [experienceMessage, setExperienceMessage] = useState("");
  const [experienceError, setExperienceError] = useState(false);
  const [education, setEducation] = useState(blankEducation);
  const [educationId, setEducationId] = useState("");
  const [educationMessage, setEducationMessage] = useState("");
  const [educationError, setEducationError] = useState(false);
  const [hobby, setHobby] = useState(blankHobby);
  const [hobbyId, setHobbyId] = useState("");
  const [hobbyMessage, setHobbyMessage] = useState("");
  const [hobbyError, setHobbyError] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const loadData = useCallback(async () => {
    const next = await api("/api/portfolio");
    setData(next);
  }, []);

  async function reorderItem(collection, id, targetId, placement, setMessage, setError) {
    setMessage("");
    setError(false);
    try {
      const result = await api(`/api/admin/${collection}/${id}/move`, {
        method: "POST",
        body: JSON.stringify({ targetId, placement }),
      });
      await loadData();
      if (result.moved && !result.publishTriggered) {
        setMessage("Ordre enregistré, mais la publication automatique n’est pas configurée.");
        setError(true);
      }
    } catch (error) {
      setMessage(error.message);
      setError(true);
    }
  }

  function startDragging(event, collection, id) {
    event.preventDefault();
    setDraggedItem({ collection, id, mode: "pointer" });
    setDropTarget(null);
  }

  function nativeDragProps(collection, id) {
    return {
      draggable: true,
      onDragStart(event) {
        if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, label")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
        setDraggedItem({ collection, id, mode: "native" });
      },
      onDragOver(event) {
        if (draggedItem?.mode !== "native" || draggedItem.collection !== collection || draggedItem.id === id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const bounds = event.currentTarget.getBoundingClientRect();
        setDropTarget({
          id,
          placement: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
        });
      },
      onDrop(event) {
        if (draggedItem?.mode !== "native" || draggedItem.collection !== collection || draggedItem.id === id) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const placement = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
        const feedback = {
          skills: [setSkillMessage, setSkillError],
          experiences: [setExperienceMessage, setExperienceError],
          education: [setEducationMessage, setEducationError],
          projects: [setProjectMessage, setProjectError],
          hobbies: [setHobbyMessage, setHobbyError],
        }[collection];
        setDraggedItem(null);
        setDropTarget(null);
        void reorderItem(collection, draggedItem.id, id, placement, ...feedback);
      },
      onDragEnd() {
        setDraggedItem(null);
        setDropTarget(null);
      },
    };
  }

  function keyboardReorder(event, collection, items, item, setMessage, setError) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const index = items.findIndex((entry) => entry.id === item.id);
    const neighbor = items[index + (event.key === "ArrowUp" ? -1 : 1)];
    if (!neighbor) return;
    event.preventDefault();
    void reorderItem(
      collection,
      item.id,
      neighbor.id,
      event.key === "ArrowUp" ? "before" : "after",
      setMessage,
      setError,
    );
  }

  useEffect(() => {
    if (!draggedItem || draggedItem.mode !== "pointer") return undefined;

    function findTarget(clientX, clientY) {
      const row = document.elementFromPoint(clientX, clientY)?.closest("[data-sortable-collection]");
      if (!(row instanceof HTMLElement) || row.dataset.sortableCollection !== draggedItem.collection) {
        return null;
      }
      const bounds = row.getBoundingClientRect();
      return {
        id: row.dataset.sortableId,
        placement: clientY < bounds.top + bounds.height / 2 ? "before" : "after",
      };
    }

    function handlePointerMove(event) {
      event.preventDefault();
      setDropTarget(findTarget(event.clientX, event.clientY));
    }

    function handlePointerUp(event) {
      const target = findTarget(event.clientX, event.clientY);
      setDraggedItem(null);
      setDropTarget(null);
      if (!target || target.id === draggedItem.id) return;

      const feedback = {
        skills: [setSkillMessage, setSkillError],
        experiences: [setExperienceMessage, setExperienceError],
        education: [setEducationMessage, setEducationError],
        projects: [setProjectMessage, setProjectError],
        hobbies: [setHobbyMessage, setHobbyError],
      }[draggedItem.collection];
      void reorderItem(draggedItem.collection, draggedItem.id, target.id, target.placement, ...feedback);
    }

    function handlePointerCancel() {
      setDraggedItem(null);
      setDropTarget(null);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [draggedItem]);

  function sortableRowClass(collection, id, baseClass) {
    const dragging = draggedItem?.collection === collection && draggedItem.id === id;
    const target = dropTarget?.id === id && draggedItem?.collection === collection;
    return `${baseClass} sortable-row${dragging ? " is-dragging" : ""}${target ? ` is-drop-target drop-${dropTarget.placement}` : ""}`;
  }

  useEffect(() => {
    let active = true;
    async function checkSession() {
      try {
        await api("/api/health");
        await api("/api/admin/me");
        if (!active) return;
        setAuthenticated(true);
        const next = await api("/api/portfolio");
        if (active) setData(next);
      } catch (error) {
        if (!active) return;
        setAuthenticated(false);
        setData(null);
        if (error.status !== 401) setApiError(error.message);
      } finally {
        if (active) setChecking(false);
      }
    }
    void checkSession();
    return () => { active = false; };
  }, []);

  async function signIn(event) {
    event.preventDefault();
    setLoginError("");
    setApiError("");
    try {
      await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await loadData();
      setAuthenticated(true);
      setPassword("");
    } catch (error) {
      setLoginError(error.message);
    }
  }

  async function signOut() {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch (error) {
      setApiError(error.message);
    } finally {
      setAuthenticated(false);
      setData(null);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setProfileMessage("");
    setProfileError(false);
    const formData = new FormData(event.currentTarget);
    const body = Object.fromEntries(formData.entries());
    try {
      const result = await api("/api/admin/profile", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      await loadData();
      setProfileMessage(result.publishTriggered
        ? "Profil enregistré. La mise à jour du site est lancée."
        : "Profil enregistré, mais la publication automatique n’est pas configurée.");
      setProfileError(!result.publishTriggered);
    } catch (error) {
      setProfileMessage(error.message);
      setProfileError(true);
    }
  }

  async function saveSkill(event) {
    event.preventDefault();
    setSkillMessage("");
    setSkillError(false);
    try {
      const result = await api(skillId ? `/api/admin/skills/${skillId}` : "/api/admin/skills", {
        method: skillId ? "PUT" : "POST",
        body: JSON.stringify({ ...skill, level: Number(skill.level) }),
      });
      await loadData();
      setSkill(blankSkill);
      setSkillId("");
      setSkillMessage(result.publishTriggered
        ? "Compétence enregistrée. La mise à jour du site est lancée."
        : "Compétence enregistrée, mais la publication automatique n’est pas configurée.");
      setSkillError(!result.publishTriggered);
    } catch (error) {
      setSkillMessage(error.message);
      setSkillError(true);
    }
  }

  async function removeSkill(id, name) {
    if (!window.confirm(`Supprimer la compétence « ${name} » ?`)) return;
    try {
      const result = await api(`/api/admin/skills/${id}`, { method: "DELETE" });
      await loadData();
      setSkillMessage(result.publishTriggered
        ? "Compétence supprimée. La mise à jour du site est lancée."
        : "Compétence supprimée, mais la publication automatique n’est pas configurée.");
      setSkillError(!result.publishTriggered);
    } catch (error) {
      setSkillMessage(error.message);
      setSkillError(true);
    }
  }

  async function saveProject(event) {
    event.preventDefault();
    setProjectMessage("");
    setProjectError(false);
    const payload = {
      ...project,
      tags: project.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    };
    try {
      const result = await api(projectId ? `/api/admin/projects/${projectId}` : "/api/admin/projects", {
        method: projectId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      await loadData();
      setProject(blankProject);
      setProjectId("");
      setProjectMessage(result.publishTriggered
        ? "Projet enregistré. La mise à jour du site est lancée."
        : "Projet enregistré, mais la publication automatique n’est pas configurée.");
      setProjectError(!result.publishTriggered);
    } catch (error) {
      setProjectMessage(error.message);
      setProjectError(true);
    }
  }

  async function removeProject(id, title) {
    if (!window.confirm(`Supprimer le projet « ${title} » ?`)) return;
    try {
      const result = await api(`/api/admin/projects/${id}`, { method: "DELETE" });
      await loadData();
      setProjectMessage(result.publishTriggered
        ? "Projet supprimé. La mise à jour du site est lancée."
        : "Projet supprimé, mais la publication automatique n’est pas configurée.");
      setProjectError(!result.publishTriggered);
    } catch (error) {
      setProjectMessage(error.message);
      setProjectError(true);
    }
  }

  async function saveExperience(event) {
    event.preventDefault();
    setExperienceMessage("");
    setExperienceError(false);
    try {
      const result = await api(experienceId
        ? `/api/admin/experiences/${experienceId}`
        : "/api/admin/experiences", {
        method: experienceId ? "PUT" : "POST",
        body: JSON.stringify(experience),
      });
      await loadData();
      setExperience(blankExperience);
      setExperienceId("");
      setExperienceMessage(result.publishTriggered
        ? "Expérience enregistrée."
        : "Expérience enregistrée, mais la publication automatique n’est pas configurée.");
      setExperienceError(!result.publishTriggered);
    } catch (error) {
      setExperienceMessage(error.message);
      setExperienceError(true);
    }
  }

  async function removeExperience(id, title) {
    if (!window.confirm(`Supprimer l’expérience « ${title} » ?`)) return;
    try {
      await api(`/api/admin/experiences/${id}`, { method: "DELETE" });
      await loadData();
      setExperienceMessage("Expérience supprimée.");
      setExperienceError(false);
    } catch (error) {
      setExperienceMessage(error.message);
      setExperienceError(true);
    }
  }

  async function saveEducation(event) {
    event.preventDefault();
    setEducationMessage("");
    setEducationError(false);
    try {
      const result = await api(educationId
        ? `/api/admin/education/${educationId}`
        : "/api/admin/education", {
        method: educationId ? "PUT" : "POST",
        body: JSON.stringify(education),
      });
      await loadData();
      setEducation(blankEducation);
      setEducationId("");
      setEducationMessage(result.publishTriggered
        ? "Formation enregistrée."
        : "Formation enregistrée, mais la publication automatique n’est pas configurée.");
      setEducationError(!result.publishTriggered);
    } catch (error) {
      setEducationMessage(error.message);
      setEducationError(true);
    }
  }

  async function removeEducation(id, title) {
    if (!window.confirm(`Supprimer la formation « ${title} » ?`)) return;
    try {
      await api(`/api/admin/education/${id}`, { method: "DELETE" });
      await loadData();
      setEducationMessage("Formation supprimée.");
      setEducationError(false);
    } catch (error) {
      setEducationMessage(error.message);
      setEducationError(true);
    }
  }

  async function saveHobby(event) {
    event.preventDefault();
    setHobbyMessage("");
    setHobbyError(false);
    try {
      const result = await api(hobbyId ? `/api/admin/hobbies/${hobbyId}` : "/api/admin/hobbies", {
        method: hobbyId ? "PUT" : "POST",
        body: JSON.stringify(hobby),
      });
      await loadData();
      setHobby(blankHobby);
      setHobbyId("");
      setHobbyMessage(result.publishTriggered
        ? "Loisir enregistré."
        : "Loisir enregistré, mais la publication automatique n’est pas configurée.");
      setHobbyError(!result.publishTriggered);
    } catch (error) {
      setHobbyMessage(error.message);
      setHobbyError(true);
    }
  }

  async function removeHobby(id, title) {
    if (!window.confirm(`Supprimer le loisir « ${title} » ?`)) return;
    try {
      await api(`/api/admin/hobbies/${id}`, { method: "DELETE" });
      await loadData();
      setHobbyMessage("Loisir supprimé.");
      setHobbyError(false);
    } catch (error) {
      setHobbyMessage(error.message);
      setHobbyError(true);
    }
  }

  if (checking) {
    return <main className="setup-screen"><p>Connexion à l’espace administrateur…</p></main>;
  }

  if (!authenticated) {
    return (
      <main className="login-screen">
        <div className="login-card">
          <a className="brand-mark" href="/">folio<span>.</span></a>
          <p className="eyebrow">ESPACE ADMINISTRATEUR</p>
          <h1>Content de te revoir.</h1>
          <p>Connecte-toi pour mettre à jour ton portfolio.</p>
          {(apiError || loginError) && <Feedback message={apiError || loginError} error />}
          {apiError && <button className="text-button api-retry" type="button" onClick={() => window.location.reload()}>Réessayer la connexion</button>}
          <form onSubmit={signIn} className="login-form">
            <label>Adresse e-mail<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            <button className="button button-dark" type="submit">Se connecter</button>
          </form>
          <a className="back-link" href="/">← Revenir au portfolio</a>
        </div>
      </main>
    );
  }

  if (!data?.profile) {
    return <main className="setup-screen"><div className="setup-card"><h1>Portfolio non initialisé.</h1><p>Vérifie la base de données du serveur API puis recharge cette page.</p><Feedback message={apiError} error /><button className="button button-dark" onClick={() => loadData().catch((error) => setApiError(error.message))}>Réessayer</button></div></main>;
  }

  const { profile, skills, projects, experiences = [], education: educationItems = [], hobbies = [] } = data;

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a className="brand-mark" href="/" target="_blank" rel="noreferrer">folio<span>.</span></a>
        <div className="admin-topbar-right">
          <a className="text-link" href="/" target="_blank" rel="noreferrer">Voir le portfolio <ArrowUpRight size={15} /></a>
          <button type="button" className="icon-button" aria-label="Se déconnecter" onClick={signOut}><LogOut size={17} /></button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-heading">
          <div><p className="eyebrow">ESPACE PERSONNEL</p><h1>Bonjour, {profile.name.split(" ")[0]}.</h1><p className="muted-copy">Tout ce que tu modifies ici est enregistré dans ton portfolio.</p></div>
          <span className="live-badge"><span /> En ligne</span>
        </div>

        <section className="admin-card">
          <div className="section-heading"><div className="section-number">01</div><div><h2>Mon profil</h2><p>Les informations principales affichées aux recruteurs.</p></div></div>
          <form className="editor-form" key={profile.updatedAt} onSubmit={saveProfile}>
            <div className="profile-form-grid">
              <PhotoPicker
                url={profile.avatarUrl}
                publicId={profile.avatarPublicId}
                onChange={({ url, publicId }) => setData((current) => ({ ...current, profile: { ...current.profile, avatarUrl: url, avatarPublicId: publicId } }))}
              />
              <div className="form-grid">
                <label>Nom affiché<input name="name" defaultValue={profile.name} required maxLength={100} /></label>
                <label>Métier / titre<input name="role" defaultValue={profile.role} required maxLength={140} /></label>
                <label>Ville<input name="location" defaultValue={profile.location} maxLength={120} /></label>
                <label>E-mail professionnel<input name="email" type="email" defaultValue={profile.email} /></label>
                <label>Téléphone<input name="phone" type="tel" defaultValue={profile.phone} maxLength={30} placeholder="+33 6 12 34 56 78" /></label>
                <label>Profil GitHub<input name="githubUrl" type="url" defaultValue={profile.githubUrl ?? ""} placeholder="https://github.com/nom" /></label>
              </div>
            </div>
            <label>À propos<textarea name="bio" defaultValue={profile.bio} rows="4" maxLength={1200} /></label>
            <input type="hidden" name="avatarUrl" value={profile.avatarUrl} />
            <input type="hidden" name="avatarPublicId" value={profile.avatarPublicId} />
            <div className="cv-admin-field">
              <span className="cv-admin-label">Mon CV</span>
              <CvPicker
                url={profile.cvUrl ?? ""}
                fileName={profile.cvFileName ?? ""}
                onChange={({ url, fileName }) => setData((current) => ({
                  ...current,
                  profile: { ...current.profile, cvUrl: url, cvFileName: fileName },
                }))}
              />
            </div>
            <input type="hidden" name="cvUrl" value={profile.cvUrl ?? ""} />
            <input type="hidden" name="cvFileName" value={profile.cvFileName ?? ""} />
            <label>Message préparé dans l’e-mail de contact<textarea name="contactMessage" defaultValue={profile.contactMessage} rows="2" maxLength={240} placeholder="Bonjour, je vous contacte au sujet de…" /></label>
            <div className="section-heading footer-editor-heading"><div className="section-number">↗</div><div><h2>Mon pied de page</h2><p>Personnalise le texte de contact affiché en bas du portfolio.</p></div></div>
            <div className="form-grid">
              <label>Petit titre<input name="footerEyebrow" defaultValue={profile.footerEyebrow} maxLength={100} /></label>
              <label>Grand titre<input name="footerTitle" defaultValue={profile.footerTitle} maxLength={140} /></label>
            </div>
            <label>Texte de contact<textarea name="footerText" defaultValue={profile.footerText} rows="2" maxLength={400} /></label>
            <label>Signature en bas de page<input name="footerNote" defaultValue={profile.footerNote} maxLength={160} /></label>
            <div className="theme-editor">
              <div><strong>Mon style</strong><span>Choisis les couleurs principales du portfolio.</span></div>
              <label className="color-control">Accent<input type="color" name="accentColor" defaultValue={profile.accentColor} /></label>
              <label className="color-control">Fond<input type="color" name="backgroundColor" defaultValue={profile.backgroundColor} /></label>
            </div>
            <div className="form-footer"><Feedback message={profileMessage} error={profileError} /><button className="button button-dark" type="submit">Enregistrer le profil</button></div>
          </form>
        </section>

        <section className="admin-card">
          <div className="section-heading"><div className="section-number">02</div><div><h2>Mes compétences</h2><p>Ajoute un logo ou une icône pour chaque compétence, par exemple Oracle.</p></div></div>
          <p className="drag-hint">Glisse une ligne ou sa poignée pour changer l’ordre.</p>
          <div className="admin-list">
            {skills.map((item) => (
              <div {...nativeDragProps("skills", item.id)} className={sortableRowClass("skills", item.id, "admin-list-row")} data-sortable-collection="skills" data-sortable-id={item.id} key={item.id}>
                <DragHandle
                  label={item.name}
                  onPointerDown={(event) => startDragging(event, "skills", item.id)}
                  onKeyDown={(event) => keyboardReorder(event, "skills", skills, item, setSkillMessage, setSkillError)}
                />
                {item.imageUrl && <img className="admin-inline-logo" src={item.imageUrl} alt="" />}
                <div className="skill-row-copy"><strong>{item.name}</strong><span>{item.category}</span><SkillRating value={item.level} /></div>
                <div className="row-actions">
                  <button className="icon-button" type="button" aria-label={`Modifier ${item.name}`} onClick={() => { setSkill({ name: item.name, category: item.category, level: item.level, imageUrl: item.imageUrl, imagePublicId: item.imagePublicId }); setSkillId(item.id); }}><Pencil size={16} /></button>
                  <button className="icon-button danger-icon" type="button" aria-label={`Supprimer ${item.name}`} onClick={() => void removeSkill(item.id, item.name)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            {!skills.length && <p className="empty-note">Aucune compétence pour le moment.</p>}
          </div>
          <form className="inline-editor" onSubmit={saveSkill}>
            <label>Compétence<input value={skill.name} onChange={(event) => setSkill({ ...skill, name: event.target.value })} placeholder="Ex. UX design" required maxLength={80} /></label>
            <label>Catégorie<input value={skill.category} onChange={(event) => setSkill({ ...skill, category: event.target.value })} placeholder="Ex. Design" required maxLength={60} /></label>
            <label className="level-input">Niveau (1 à 5)<select value={skill.level} onChange={(event) => setSkill({ ...skill, level: Number(event.target.value) })} required>{[1, 2, 3, 4, 5].map((point) => <option value={point} key={point}>{point} / 5</option>)}</select></label>
            <div className="inline-photo"><PhotoPicker url={skill.imageUrl} publicId={skill.imagePublicId} onChange={({ url, publicId }) => setSkill({ ...skill, imageUrl: url, imagePublicId: publicId })} /></div>
            <div className="editor-actions">{skillId && <button className="text-button" type="button" onClick={() => { setSkill(blankSkill); setSkillId(""); }}>Annuler</button>}<button className="button button-dark" type="submit">{skillId ? "Modifier" : <><Plus size={16} /> Ajouter</>}</button></div>
            <Feedback message={skillMessage} error={skillError} />
          </form>
        </section>

        <section className="admin-card">
          <div className="section-heading"><div className="section-number">03</div><div><h2>Mon expérience</h2><p>Décris ton parcours et les responsabilités qui montrent ton expérience senior.</p></div></div>
          <p className="drag-hint">Glisse une ligne ou sa poignée pour changer l’ordre.</p>
          <div className="project-admin-list">
            {experiences.map((item) => (
              <div {...nativeDragProps("experiences", item.id)} className={sortableRowClass("experiences", item.id, "project-admin-row")} data-sortable-collection="experiences" data-sortable-id={item.id} key={item.id}>
                <DragHandle
                  label={item.role}
                  onPointerDown={(event) => startDragging(event, "experiences", item.id)}
                  onKeyDown={(event) => keyboardReorder(event, "experiences", experiences, item, setExperienceMessage, setExperienceError)}
                />
                <div className="project-admin-thumb">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>↗</span>}</div>
                <div className="project-admin-copy"><strong>{item.role}</strong><span>{item.company} · {item.startDate} – {item.endDate || "Aujourd’hui"}</span></div>
                <div className="row-actions">
                  <button className="icon-button" type="button" aria-label={`Modifier ${item.role}`} onClick={() => { setExperience({ role: item.role, company: item.company, location: item.location, startDate: item.startDate, endDate: item.endDate, description: item.description, imageUrl: item.imageUrl, imagePublicId: item.imagePublicId }); setExperienceId(item.id); }}><Pencil size={16} /></button>
                  <button className="icon-button danger-icon" type="button" aria-label={`Supprimer ${item.role}`} onClick={() => void removeExperience(item.id, item.role)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            {!experiences.length && <p className="empty-note">Ajoute tes postes, dates et principales réalisations.</p>}
          </div>
          <form className="project-editor" onSubmit={saveExperience}>
            <div className="form-grid">
              <label>Poste<input value={experience.role} onChange={(event) => setExperience({ ...experience, role: event.target.value })} placeholder="Ex. Développeur senior" required maxLength={120} /></label>
              <label>Entreprise<input value={experience.company} onChange={(event) => setExperience({ ...experience, company: event.target.value })} placeholder="Ex. Oracle" required maxLength={120} /></label>
              <label>Lieu<input value={experience.location} onChange={(event) => setExperience({ ...experience, location: event.target.value })} placeholder="Ex. Paris / Hybride" maxLength={120} /></label>
              <label>Début<input type="month" value={experience.startDate} onChange={(event) => setExperience({ ...experience, startDate: event.target.value })} required /></label>
              <label>Fin (vide si poste actuel)<input type="month" value={experience.endDate} onChange={(event) => setExperience({ ...experience, endDate: event.target.value })} /></label>
            </div>
            <label>Responsabilités et réalisations<textarea value={experience.description} onChange={(event) => setExperience({ ...experience, description: event.target.value })} rows="3" maxLength={1200} placeholder="Décris tes responsabilités, résultats et technologies…" /></label>
            <PhotoPicker url={experience.imageUrl} publicId={experience.imagePublicId} onChange={({ url, publicId }) => setExperience({ ...experience, imageUrl: url, imagePublicId: publicId })} />
            <div className="form-footer"><Feedback message={experienceMessage} error={experienceError} /><div className="editor-actions">{experienceId && <button className="text-button" type="button" onClick={() => { setExperience(blankExperience); setExperienceId(""); }}>Annuler</button>}<button className="button button-dark" type="submit">{experienceId ? "Modifier le poste" : <><Plus size={16} /> Ajouter une expérience</>}</button></div></div>
          </form>
        </section>

        <section className="admin-card">
          <div className="section-heading"><div className="section-number">04</div><div><h2>Mes formations</h2><p>Ajoute tes diplômes, études et formations professionnelles.</p></div></div>
          <p className="drag-hint">Glisse une ligne ou sa poignée pour changer l’ordre.</p>
          <div className="project-admin-list">
            {educationItems.map((item) => (
              <div {...nativeDragProps("education", item.id)} className={sortableRowClass("education", item.id, "project-admin-row")} data-sortable-collection="education" data-sortable-id={item.id} key={item.id}>
                <DragHandle
                  label={item.degree}
                  onPointerDown={(event) => startDragging(event, "education", item.id)}
                  onKeyDown={(event) => keyboardReorder(event, "education", educationItems, item, setEducationMessage, setEducationError)}
                />
                <div className="project-admin-thumb">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>◇</span>}</div>
                <div className="project-admin-copy"><strong>{item.degree}</strong><span>{item.institution} · {item.startDate} – {item.endDate || "En cours"}</span></div>
                <div className="row-actions">
                  <button className="icon-button" type="button" aria-label={`Modifier ${item.degree}`} onClick={() => { setEducation({ degree: item.degree, institution: item.institution, location: item.location, startDate: item.startDate, endDate: item.endDate, description: item.description, imageUrl: item.imageUrl, imagePublicId: item.imagePublicId }); setEducationId(item.id); }}><Pencil size={16} /></button>
                  <button className="icon-button danger-icon" type="button" aria-label={`Supprimer ${item.degree}`} onClick={() => void removeEducation(item.id, item.degree)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            {!educationItems.length && <p className="empty-note">Ajoute tes diplômes, établissements et périodes de formation.</p>}
          </div>
          <form className="project-editor" onSubmit={saveEducation}>
            <div className="form-grid">
              <label>Diplôme ou formation<input value={education.degree} onChange={(event) => setEducation({ ...education, degree: event.target.value })} placeholder="Ex. Master informatique" required maxLength={140} /></label>
              <label>Établissement<input value={education.institution} onChange={(event) => setEducation({ ...education, institution: event.target.value })} placeholder="Ex. Université de Montréal" required maxLength={140} /></label>
              <label>Lieu<input value={education.location} onChange={(event) => setEducation({ ...education, location: event.target.value })} placeholder="Ex. Montréal" maxLength={120} /></label>
              <label>Début<input type="month" value={education.startDate} onChange={(event) => setEducation({ ...education, startDate: event.target.value })} required /></label>
              <label>Fin (vide si en cours)<input type="month" value={education.endDate} onChange={(event) => setEducation({ ...education, endDate: event.target.value })} /></label>
            </div>
            <label>Détails<textarea value={education.description} onChange={(event) => setEducation({ ...education, description: event.target.value })} rows="3" maxLength={1200} placeholder="Spécialité, projets importants, mention obtenue…" /></label>
            <PhotoPicker url={education.imageUrl} publicId={education.imagePublicId} onChange={({ url, publicId }) => setEducation({ ...education, imageUrl: url, imagePublicId: publicId })} />
            <div className="form-footer"><Feedback message={educationMessage} error={educationError} /><div className="editor-actions">{educationId && <button className="text-button" type="button" onClick={() => { setEducation(blankEducation); setEducationId(""); }}>Annuler</button>}<button className="button button-dark" type="submit">{educationId ? "Modifier la formation" : <><Plus size={16} /> Ajouter une formation</>}</button></div></div>
          </form>
        </section>

        <section className="admin-card">
          <div className="section-heading"><div className="section-number">05</div><div><h2>Mes projets</h2><p>Présente ton travail avec des images, une description et des liens.</p></div></div>
          <p className="drag-hint">Glisse une ligne ou sa poignée pour changer l’ordre.</p>
          <div className="project-admin-list">
            {projects.map((item) => (
              <div {...nativeDragProps("projects", item.id)} className={sortableRowClass("projects", item.id, "project-admin-row")} data-sortable-collection="projects" data-sortable-id={item.id} key={item.id}>
                <DragHandle
                  label={item.title}
                  onPointerDown={(event) => startDragging(event, "projects", item.id)}
                  onKeyDown={(event) => keyboardReorder(event, "projects", projects, item, setProjectMessage, setProjectError)}
                />
                <div className="project-admin-thumb">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>+</span>}</div>
                <div className="project-admin-copy"><strong>{item.title}</strong><span>{item.tags.join(" · ") || "Sans catégorie"}</span></div>
                <div className="row-actions">
                  <button className="icon-button" type="button" aria-label={`Modifier ${item.title}`} onClick={() => { setProject({ ...item, tags: item.tags.join(", ") }); setProjectId(item.id); }}><Pencil size={16} /></button>
                  <button className="icon-button danger-icon" type="button" aria-label={`Supprimer ${item.title}`} onClick={() => void removeProject(item.id, item.title)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            {!projects.length && <p className="empty-note">Aucun projet pour le moment.</p>}
          </div>
          <form className="project-editor" onSubmit={saveProject}>
            <div className="form-grid">
              <label>Titre du projet<input value={project.title} onChange={(event) => setProject({ ...project, title: event.target.value })} placeholder="Ex. Refonte de marque" required maxLength={120} /></label>
              <label>Lien du projet (facultatif)<input type="url" value={project.link} onChange={(event) => setProject({ ...project, link: event.target.value })} placeholder="https://" /></label>
            </div>
            <label>Description<textarea value={project.description} onChange={(event) => setProject({ ...project, description: event.target.value })} rows="3" maxLength={1200} required /></label>
            <label>Catégories (séparées par des virgules)<input value={project.tags} onChange={(event) => setProject({ ...project, tags: event.target.value })} placeholder="Design, Identité, Web" /></label>
            <PhotoPicker
              url={project.imageUrl}
              publicId={project.imagePublicId}
              onChange={({ url, publicId }) => setProject({ ...project, imageUrl: url, imagePublicId: publicId })}
            />
            <div className="form-footer"><Feedback message={projectMessage} error={projectError} /><div className="editor-actions">{projectId && <button className="text-button" type="button" onClick={() => { setProject(blankProject); setProjectId(""); }}>Annuler</button>}<button className="button button-dark" type="submit">{projectId ? "Modifier le projet" : <><Plus size={16} /> Ajouter le projet</>}</button></div></div>
          </form>
        </section>

        <section className="admin-card">
          <div className="section-heading"><div className="section-number">06</div><div><h2>Mes loisirs</h2><p>Ajoute des passions pour partager un aperçu plus personnel de ton parcours.</p></div></div>
          <p className="drag-hint">Glisse une ligne ou sa poignée pour changer l’ordre.</p>
          <div className="project-admin-list">
            {hobbies.map((item) => (
              <div {...nativeDragProps("hobbies", item.id)} className={sortableRowClass("hobbies", item.id, "project-admin-row")} data-sortable-collection="hobbies" data-sortable-id={item.id} key={item.id}>
                <DragHandle
                  label={item.title}
                  onPointerDown={(event) => startDragging(event, "hobbies", item.id)}
                  onKeyDown={(event) => keyboardReorder(event, "hobbies", hobbies, item, setHobbyMessage, setHobbyError)}
                />
                <div className="project-admin-thumb">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>✳</span>}</div>
                <div className="project-admin-copy"><strong>{item.title}</strong><span>{item.description || "Aucune description"}</span></div>
                <div className="row-actions">
                  <button className="icon-button" type="button" aria-label={`Modifier ${item.title}`} onClick={() => { setHobby({ title: item.title, description: item.description, imageUrl: item.imageUrl, imagePublicId: item.imagePublicId }); setHobbyId(item.id); }}><Pencil size={16} /></button>
                  <button className="icon-button danger-icon" type="button" aria-label={`Supprimer ${item.title}`} onClick={() => void removeHobby(item.id, item.title)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
            {!hobbies.length && <p className="empty-note">Aucun loisir pour le moment.</p>}
          </div>
          <form className="project-editor" onSubmit={saveHobby}>
            <label>Loisir<input value={hobby.title} onChange={(event) => setHobby({ ...hobby, title: event.target.value })} placeholder="Ex. Photographie, randonnée…" required maxLength={100} /></label>
            <label>Description<textarea value={hobby.description} onChange={(event) => setHobby({ ...hobby, description: event.target.value })} rows="3" maxLength={600} /></label>
            <PhotoPicker url={hobby.imageUrl} publicId={hobby.imagePublicId} onChange={({ url, publicId }) => setHobby({ ...hobby, imageUrl: url, imagePublicId: publicId })} />
            <div className="form-footer"><Feedback message={hobbyMessage} error={hobbyError} /><div className="editor-actions">{hobbyId && <button className="text-button" type="button" onClick={() => { setHobby(blankHobby); setHobbyId(""); }}>Annuler</button>}<button className="button button-dark" type="submit">{hobbyId ? "Modifier le loisir" : <><Plus size={16} /> Ajouter un loisir</>}</button></div></div>
          </form>
        </section>

        <p className="admin-footnote">En local, les modifications apparaissent directement sur le portfolio.</p>
      </main>
    </div>
  );
}
