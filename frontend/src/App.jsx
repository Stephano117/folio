import { useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, Download, Github, Mail, MapPin, Phone } from "lucide-react";
import Admin from "./admin.jsx";

function contactMailto(profile) {
  const subject = encodeURIComponent(`Prise de contact - ${profile.name}`);
  const body = encodeURIComponent(profile.contactMessage || `Bonjour ${profile.name},`);
  return `mailto:${profile.email}?subject=${subject}&body=${body}`;
}

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(date);
}

function Portfolio() {
  const [portfolio, setPortfolio] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetch(import.meta.env.DEV ? "/api/portfolio" : "/portfolio.json")
      .then((response) => {
        if (!response.ok) throw new Error("Le portfolio ne peut pas être chargé.");
        return response.json();
      })
      .then(setPortfolio)
      .catch((error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    let frame = 0;
    // échéance pendant laquelle la nav reste visible quoi qu'il arrive : elle ne
    // peut que s'allonger, sinon un évènement de scroll isolé raccourcirait le
    // verrou posé par un clic
    let keepVisibleUntil = 0;
    const keepVisible = (ms) => {
      keepVisibleUntil = Math.max(keepVisibleUntil, performance.now() + ms);
    };

    const update = () => {
      frame = 0;
      const nav = document.querySelector(".site-nav");
      if (!nav) return;
      const y = Math.max(window.scrollY, 0);
      nav.classList.toggle("is-scrolled", y > 8);
      if (performance.now() < keepVisibleUntil) {
        nav.classList.remove("nav-hidden");
        lastY = y;
        return;
      }
      // seuil de 6px : évite que la nav clignote sur un micro-scroll
      if (Math.abs(y - lastY) > 6) {
        nav.classList.toggle("nav-hidden", y > lastY && y > 140);
        lastY = y;
      }
    };

    const onScroll = () => {
      // un scroll lancé par un clic est fluide et peut durer longtemps : tant
      // qu'il défile, on prolonge le verrou
      if (performance.now() < keepVisibleUntil) keepVisible(220);
      if (!frame) frame = requestAnimationFrame(update);
    };

    const onClick = (event) => {
      if (!event.target?.closest?.(".site-nav a")) return;
      keepVisible(700);
      if (!frame) frame = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick);
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [portfolio]);

  if (loadError) {
    return <main className="setup-screen"><div className="setup-card"><h1>Portfolio indisponible.</h1><p>{loadError}</p></div></main>;
  }
  if (!portfolio) {
    return <main className="setup-screen"><p>Chargement du portfolio…</p></main>;
  }

  const { profile, skills = [], projects = [], experiences = [], education = [], hobbies = [] } = portfolio;
  const theme = {
    "--accent": profile.accentColor,
    "--paper": profile.backgroundColor,
  };
  const firstName = profile.name.split(" ")[0];
  const footerTitle = profile.footerTitle ?? "";
  const footerPunctuation = footerTitle.match(/[.!?]+$/)?.[0] ?? ".";
  const footerHeading = footerTitle.replace(/[.!?]+$/, "");

  return (
    <main className="portfolio-page" style={theme}>
      <nav className="site-nav content-width">
        <a className="brand-mark" href="#top">folio<span>.</span></a>
        <div className="nav-links">
          <a href="#experiences">Parcours</a>
          <a href="#education">Formations</a>
          <a href="#projets">Projets</a>
          <a href="#competences">Compétences</a>
          <a href="#loisirs">Loisirs</a>
          <a className="nav-contact" href={profile.email ? contactMailto(profile) : "#contact"}>
            Me contacter <ArrowUpRight size={14} />
          </a>
        </div>
      </nav>

      <section className="hero content-width" id="top">
        <div className="hero-copy">
          <div className="availability"><span /> À la recherche de nouvelles opportunités</div>
          <h1>Bonjour,<br />moi c’est <span>{firstName}.</span></h1>
          <p className="hero-role">{profile.role}</p>
          <p className="hero-bio">{profile.bio}</p>
          <div className="hero-meta">
            {profile.location && <span><MapPin size={15} /> {profile.location}</span>}
            {profile.email && <a href={contactMailto(profile)}>Écris-moi <ArrowUpRight size={14} /></a>}
            {profile.phone && <a className="phone-link" href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`}><Phone size={14} />{profile.phone}</a>}
            {profile.githubUrl && <a className="github-link" href={profile.githubUrl} target="_blank" rel="noreferrer"><Github size={15} /> GitHub</a>}
            {profile.cvUrl && (
              <a className="hero-cv-link" href={profile.cvUrl} download={profile.cvFileName || "CV.pdf"}>
                <Download size={15} /> Télécharger mon CV
              </a>
            )}
          </div>
          <a className="scroll-cue" href="#projets"><ArrowDown size={16} /> Découvrir mon travail</a>
        </div>
        <div className="hero-visual">
          <div className="hero-image">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={profile.name} fetchPriority="high" />
            ) : (
              <div className="portrait-placeholder">
                {profile.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
              </div>
            )}
          </div>
          <div className="hero-note">Créativité<br />& précision <span>✳</span></div>
          <div className="hero-index">01 / 04</div>
        </div>
      </section>

      <section className="experience-section content-width" id="experiences">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">MON PARCOURS</p>
              <h2>Expérience<span>.</span></h2>
            </div>
            <span className="section-count">{String(experiences.length).padStart(2, "0")} étapes</span>
          </div>
          <div className="experience-list">
            {experiences.map((experience) => (
              <article className="experience-card" key={experience.id}>
                {experience.imageUrl && <img className="experience-logo" src={experience.imageUrl} alt={`Logo ${experience.company}`} loading="lazy" />}
                <div className="experience-copy">
                  <p className="experience-period">{dateLabel(experience.startDate)} — {experience.endDate ? dateLabel(experience.endDate) : "Aujourd’hui"}</p>
                  <h3>{experience.role}</h3>
                  <p className="experience-company">{experience.company}{experience.location && ` · ${experience.location}`}</p>
                  {experience.description && <p className="experience-description">{experience.description}</p>}
                </div>
              </article>
            ))}
          </div>
          {!experiences.length && <p className="public-empty">Mon parcours professionnel sera bientôt renseigné.</p>}
      </section>

      <section className="education-section content-width" id="education">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">ÉTUDES & APPRENTISSAGES</p>
            <h2>Formation<span>.</span></h2>
          </div>
          <span className="section-count">{String(education.length).padStart(2, "0")} étapes</span>
        </div>
        {education.length ? (
          <div className="experience-list">
            {education.map((item) => (
              <article className="experience-card education-card" key={item.id}>
                {item.imageUrl
                  ? <img className="experience-logo" src={item.imageUrl} alt={`Logo ${item.institution}`} loading="lazy" />
                  : <div className="education-logo" aria-hidden="true">◇</div>}
                <div className="experience-copy">
                  <p className="experience-period">{dateLabel(item.startDate)} — {item.endDate ? dateLabel(item.endDate) : "En cours"}</p>
                  <h3>{item.degree}</h3>
                  <p className="experience-company">{item.institution}{item.location && ` · ${item.location}`}</p>
                  {item.description && <p className="experience-description">{item.description}</p>}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="public-empty">Mes formations seront bientôt renseignées.</p>}
      </section>

      <section className="projects-section content-width" id="projets">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">SÉLECTION RÉCENTE</p>
            <h2>Projets réalisés<span>.</span></h2>
          </div>
          <span className="section-count">{String(projects.length).padStart(2, "0")} projets</span>
        </div>
        {projects.length ? (
          <div className="project-grid">
            {projects.map((project, index) => (
              <article className={`project-card project-card-${index % 2}`} key={project.id}>
                <a
                  className="project-image"
                  href={project.link || "#projets"}
                  target={project.link ? "_blank" : undefined}
                  rel={project.link ? "noreferrer" : undefined}
                  aria-label={`Voir le projet ${project.title}`}
                >
                  {project.imageUrl ? (
                    <img src={project.imageUrl} alt={project.title} loading="lazy" />
                  ) : (
                    <div className={`project-placeholder placeholder-${index % 3}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{project.title}</strong>
                    </div>
                  )}
                  <span className="project-arrow"><ArrowUpRight size={18} /></span>
                </a>
                <div className="project-info">
                  <div><h3>{project.title}</h3><p>{project.description}</p></div>
                  <div className="tag-list">{project.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="public-empty">Mes prochains projets arrivent bientôt.</p>}
      </section>

      <section className="skills-section content-width" id="competences">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">CE QUE JE SAIS FAIRE</p>
            <h2>Mes compétences<span>.</span></h2>
          </div>
          <span className="section-count">{String(skills.length).padStart(2, "0")} expertises</span>
        </div>
        {skills.length ? (
          <div className="skills-grid">
            {skills.map((skill, index) => (
              <div className="skill-card" key={skill.id}>
                <div className="skill-card-top"><span>0{index + 1}</span><span>{skill.category}</span></div>
                <div className={`skill-brand${skill.imageUrl ? " has-image" : ""}`}>
                  {skill.imageUrl && <img src={skill.imageUrl} alt="" loading="lazy" />}
                  <h3>{skill.name}</h3>
                </div>
                <div className="skill-rating" role="img" aria-label={`${skill.level} sur 5`}>
                  {[1, 2, 3, 4, 5].map((point) => (
                    <span className={point <= skill.level ? "skill-rating-point is-filled" : "skill-rating-point"} key={point} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="public-empty">Les compétences seront bientôt ajoutées.</p>}
      </section>

      <section className="hobbies-section content-width" id="loisirs">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">HORS DU TRAVAIL</p>
              <h2>Mes loisirs<span>.</span></h2>
            </div>
            <span className="section-count">{String(hobbies.length).padStart(2, "0")} passions</span>
          </div>
          <div className="hobby-grid">
            {hobbies.map((hobby, index) => (
              <article className="hobby-card" key={hobby.id}>
                {hobby.imageUrl ? (
                  <img className="hobby-image" src={hobby.imageUrl} alt={hobby.title} loading="lazy" />
                ) : (
                  <div className={`hobby-image hobby-placeholder placeholder-${index % 3}`} aria-hidden="true">{hobby.title.slice(0, 1)}</div>
                )}
                <h3>{hobby.title}</h3>
                {hobby.description && <p>{hobby.description}</p>}
              </article>
            ))}
          </div>
          {!hobbies.length && <p className="public-empty">Je partagerai bientôt quelques-unes de mes passions.</p>}
      </section>

      <footer className="site-footer" id="contact">
        <div className="content-width footer-inner">
          <div className="footer-copy">
            {profile.footerEyebrow && <p className="eyebrow">{profile.footerEyebrow}</p>}
            {profile.footerTitle && <h2>{footerHeading}<span>{footerPunctuation}</span></h2>}
            {profile.footerText && <p>{profile.footerText}</p>}
          </div>
          <div className="footer-contact-list">
            {profile.location && <span className="footer-location"><MapPin size={17} />{profile.location}</span>}
            {profile.email && <a className="footer-email" href={contactMailto(profile)}><Mail size={17} />{profile.email}<ArrowUpRight size={18} /></a>}
            {profile.phone && <a className="footer-email" href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`}><Phone size={17} />{profile.phone}<ArrowUpRight size={18} /></a>}
            {profile.cvUrl && <a className="footer-email" href={profile.cvUrl} download={profile.cvFileName || "CV.pdf"}><Download size={17} />Télécharger mon CV<ArrowUpRight size={18} /></a>}
            {profile.githubUrl && <a className="footer-email" href={profile.githubUrl} target="_blank" rel="noreferrer"><Github size={17} />Profil GitHub<ArrowUpRight size={18} /></a>}
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} {profile.name}</span>
            <span>{profile.footerNote}</span>
            <a href="/admin">Administration ↗</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

export default function App() {
  return window.location.pathname === "/admin" ? <Admin /> : <Portfolio />;
}
