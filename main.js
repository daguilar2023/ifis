(() => {
  const navLinks = document.querySelectorAll("[data-nav]");
  const currentPage = document.body.getAttribute("data-page");

  navLinks.forEach((link) => {
    if (link.getAttribute("data-nav") === currentPage) {
      link.classList.add("active");
      link.setAttribute("aria-current", "page");
    }
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
