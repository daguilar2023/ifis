(() => {
  const navLinks = document.querySelectorAll("[data-nav]");
  const currentPage = document.body.getAttribute("data-page");

  navLinks.forEach((link) => {
    if (link.getAttribute("data-nav") === currentPage) {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
    }
  });

  // Subtle entrance animation for page sections
  document.documentElement.classList.add("js-ready");
  requestAnimationFrame(() => {
    document.body.classList.add("is-loaded");
  });

  const contactForm = document.querySelector("[data-contact-form]");
  if (contactForm) {
    contactForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const data = new FormData(contactForm);
      const value = (name) => String(data.get(name) || "").trim();
      const body = [
        `Nombre: ${value("nombre")}`,
        `Empresa u organización: ${value("empresa")}`,
        `Correo electrónico: ${value("correo")}`,
        `Teléfono: ${value("telefono")}`,
        `Servicio de interés: ${value("servicio")}`,
        "",
        "Mensaje:",
        value("mensaje"),
        "",
        `Consentimiento: ${value("consentimiento") || "No informado"}`,
      ].join("\n");

      const subject = encodeURIComponent("Consulta desde sitio web IFIS");
      const encodedBody = encodeURIComponent(body);
      window.location.href = `mailto:contacto@ifisconsultores.com?subject=${subject}&body=${encodedBody}`;
    });
  }

  const publicationsGrid = document.getElementById("publicationsGrid");
  if (publicationsGrid) {
    const todayIso = new Date().toISOString();
    const fallbackItems = [
      {
        title: "IFRS 18 – Experiencias en su Aplicación (Novena Entrega)",
        description: "Experiencias prácticas de IFIS en la aplicación de IFRS 18 (novena entrega).",
        createdAt: todayIso,
        pdfUrl: "publicaciones/IFRS%2018%20-%20Experiencias%20en%20su%20Aplicaci%C3%B3n%20(Novena%20Entrega).pdf",
        thumbUrl: "media/pdf-placeholder.svg",
      },
      {
        title: "IFRS 18 – Experiencias en su Aplicación (Octava Entrega)",
        description: "Experiencias prácticas de IFIS en la aplicación de IFRS 18 (octava entrega).",
        createdAt: todayIso,
        pdfUrl: "publicaciones/IFRS%2018%20-%20Experiencias%20en%20su%20Aplicaci%C3%B3n%20(Octava%20Entrega).pdf",
        thumbUrl: "media/pdf-placeholder.svg",
      },
      {
        title: "Comunicado CMF – Ampliación de Plazo NIIF S1 y S2",
        description: "Comunicado sobre ampliación de plazo relacionada con NIIF S1 y S2.",
        createdAt: todayIso,
        pdfUrl: "publicaciones/Comunicado%20CMF%20-%20Ampliaci%C3%B3n%20de%20Plazo%20%20NIIF%20S1%20y%20S2.pdf",
        thumbUrl: "media/pdf-placeholder.svg",
      },
      {
        title: "NCG 572-2026 Ampliación de Plazo",
        description: "Norma de carácter general NCG 572-2026 sobre ampliación de plazo.",
        createdAt: todayIso,
        pdfUrl: "publicaciones/NCG_572_2026%20Ampliaci%C3%B3n%20de%20Plazo.pdf",
        thumbUrl: "media/pdf-placeholder.svg",
      },
      {
        title: "IFRS 18 – Decisión de Agenda del Comité de Interpretaciones",
        description: "Informe IFIS sobre la decisión de agenda emitida por el Comité de Interpretaciones, marzo 2026.",
        createdAt: todayIso,
        pdfUrl: "publicaciones/IFRS%2018%20-%20Decisi%C3%B3n%20de%20Agenda%20del%20Comit%C3%A9%20de%20Interpretaciones%20(marzo%202026)%20FINAL.pdf",
        thumbUrl: "media/thumbs/ifrs18-agenda-thumb.png",
      },
      {
        title: "IFRS 18 – Medidas del Rendimiento Definidas por la Gerencia",
        description: "Guía IFIS sobre la presentación de medidas de rendimiento definidas por la gerencia.",
        createdAt: todayIso,
        pdfUrl: "publicaciones/IFRS%2018%20-%20Medidas%20del%20Rendimiento%20Definidas%20por%20la%20Gerencia%20FINAL%20IFIS%20(Sexta%20Entrega).pdf",
        thumbUrl: "media/thumbs/ifrs18-rendimiento-thumb.png",
      },
    ];

    const formatDate = (iso) => {
      try {
        return new Intl.DateTimeFormat("es-CL", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }).format(new Date(iso));
      } catch {
        return "";
      }
    };

    const escapeHtml = (value) =>
      String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

    const renderPublications = (items) => {
      const sorted = [...items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      publicationsGrid.innerHTML = sorted
        .map(
          (item, index) => `
        <article class="card publication-card reveal-card" style="--reveal-delay: ${index * 60}ms">
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="publication-date">Agregado: ${escapeHtml(formatDate(item.createdAt))}</p>
            <p class="card-meta">${escapeHtml(item.description || "")}</p>
            <a class="button-link" href="${escapeHtml(item.pdfUrl)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a>
          </div>
          <div class="publication-card-preview">
            <img src="${escapeHtml(item.thumbUrl || "media/pdf-placeholder.svg")}" alt="Vista previa de ${escapeHtml(item.title)}" />
          </div>
        </article>`
        )
        .join("");
    };

    fetch("/api/publications")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (data.items && data.items.length) {
          renderPublications(data.items);
        } else {
          renderPublications(fallbackItems);
        }
      })
      .catch(() => renderPublications(fallbackItems));
  }

  const carousel = document.querySelector("[data-carousel]");
  if (!carousel) return;

  const track = carousel.querySelector("[data-carousel-track]");
  const slides = track ? Array.from(track.children) : [];
  if (!track || slides.length === 0) return;

  const prevBtn = carousel.querySelector("[data-carousel-prev]");
  const nextBtn = carousel.querySelector("[data-carousel-next]");
  const dots = Array.from(carousel.querySelectorAll("[data-carousel-dot]"));

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const autoplayMs = 6000;

  let current = 0;
  let timerId = null;

  const render = (instant = false) => {
    if (instant) {
      track.classList.add("is-instant");
    }
    track.style.transform = `translateX(-${current * 100}%)`;
    if (instant) {
      void track.offsetWidth;
      track.classList.remove("is-instant");
    }
    dots.forEach((dot, i) => {
      const isActive = i === current;
      dot.classList.toggle("is-active", isActive);
      dot.setAttribute("aria-current", isActive ? "true" : "false");
    });
  };

  const goTo = (index) => {
    const next = ((index % slides.length) + slides.length) % slides.length;
    if (next === current) return;
    current = next;
    render(false);
  };

  const next = () => goTo(current + 1);
  const prev = () => goTo(current - 1);

  const startAutoplay = () => {
    if (reducedMotion || slides.length <= 1) return;
    stopAutoplay();
    timerId = window.setInterval(next, autoplayMs);
  };

  const stopAutoplay = () => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  };

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      prev();
      startAutoplay();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      next();
      startAutoplay();
    });
  }

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      const idx = Number(dot.getAttribute("data-carousel-dot"));
      if (!Number.isNaN(idx)) {
        goTo(idx);
        startAutoplay();
      }
    });
  });

  carousel.addEventListener("mouseenter", stopAutoplay);
  carousel.addEventListener("mouseleave", startAutoplay);
  carousel.addEventListener("focusin", stopAutoplay);
  carousel.addEventListener("focusout", startAutoplay);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAutoplay();
    } else {
      startAutoplay();
    }
  });

  render(true);
  startAutoplay();
})();
