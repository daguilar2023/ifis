(() => {
  const loginView = document.getElementById("loginView");
  const dashboardView = document.getElementById("dashboardView");
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const uploadForm = document.getElementById("uploadForm");
  const uploadStatus = document.getElementById("uploadStatus");
  const adminList = document.getElementById("adminList");
  const logoutBtn = document.getElementById("logoutBtn");
  const confirmModal = document.getElementById("confirmModal");
  const confirmText = document.getElementById("confirmText");
  const confirmCancel = document.getElementById("confirmCancel");
  const confirmDelete = document.getElementById("confirmDelete");

  let csrf = "";
  let pendingDeleteId = null;

  const formatDate = (iso) => {
    try {
      return new Intl.DateTimeFormat("es-CL", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  const setCsrf = (value) => {
    csrf = value || "";
  };

  const showLogin = () => {
    loginView.hidden = false;
    dashboardView.hidden = true;
  };

  const showDashboard = () => {
    loginView.hidden = true;
    dashboardView.hidden = false;
  };

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Error de solicitud");
      error.status = response.status;
      throw error;
    }
    return data;
  };

  const renderList = (items) => {
    if (!items.length) {
      adminList.innerHTML = "<p>No hay publicaciones todavía.</p>";
      return;
    }

    adminList.innerHTML = items
      .map(
        (item) => `
      <article class="admin-item" data-id="${item.id}">
        <div class="admin-item-top">
          <div>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="admin-item-meta">Agregado: ${escapeHtml(formatDate(item.createdAt))}</p>
            <p class="admin-item-meta">${escapeHtml(item.description || "")}</p>
          </div>
          <a class="text-link" href="${item.pdfUrl}" target="_blank" rel="noopener">Abrir PDF</a>
        </div>
        <div class="admin-edit-fields">
          <label>
            Título
            <input type="text" data-edit-title value="${escapeAttr(item.title)}" maxlength="200" />
          </label>
          <label>
            Descripción
            <textarea data-edit-description rows="2" maxlength="800">${escapeHtml(item.description || "")}</textarea>
          </label>
        </div>
        <div class="admin-item-actions">
          <button type="button" class="button-link" data-save>Guardar cambios</button>
          <button type="button" class="button-link button-danger" data-delete>Eliminar</button>
        </div>
      </article>`
      )
      .join("");
  };

  const escapeHtml = (value) =>
    String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const escapeAttr = (value) => escapeHtml(value).replaceAll("`", "&#96;");

  const ensurePdfJs = () => {
    if (!window.pdfjsLib) {
      throw new Error("No se pudo cargar el generador de vista previa PDF");
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    return window.pdfjsLib;
  };

  const generatePdfThumbnail = async (pdfFile) => {
    const pdfjsLib = ensurePdfJs();
    const data = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    const targetWidth = 440;
    const scale = targetWidth / unscaled.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error("No se pudo crear la imagen de vista previa"));
      }, "image/png");
    });
    return new File([blob], "preview.png", { type: "image/png" });
  };

  const loadPublications = async () => {
    const data = await api("/api/admin/publications");
    setCsrf(data.csrf);
    renderList(data.items || []);
  };

  const bootstrap = async () => {
    try {
      const data = await api("/api/admin/session");
      setCsrf(data.csrf);
      showDashboard();
      await loadPublications();
    } catch {
      showLogin();
    }
  };

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    const password = new FormData(loginForm).get("password");
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      setCsrf(data.csrf);
      loginForm.reset();
      showDashboard();
      await loadPublications();
    } catch (error) {
      loginError.textContent = error.message || "No se pudo iniciar sesión";
      loginError.hidden = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch {
      // ignore
    }
    showLogin();
  });

  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    uploadStatus.hidden = true;
    uploadStatus.style.color = "";
    const formData = new FormData(uploadForm);
    formData.set("csrf", csrf);

    const pdf = formData.get("pdf");
    const thumb = formData.get("thumb");
    const hasManualThumb = thumb && typeof thumb !== "string" && thumb.size > 0;

    try {
      uploadStatus.textContent = hasManualThumb
        ? "Subiendo documento…"
        : "Generando vista previa de la primera página…";
      uploadStatus.hidden = false;

      if (!hasManualThumb) {
        if (!pdf || typeof pdf === "string" || !pdf.size) {
          throw new Error("Debe adjuntar un PDF");
        }
        const preview = await generatePdfThumbnail(pdf);
        formData.set("thumb", preview, "preview.png");
      }

      uploadStatus.textContent = "Subiendo documento…";
      const data = await api("/api/admin/publications", {
        method: "POST",
        body: formData,
      });
      setCsrf(data.csrf);
      uploadForm.reset();
      uploadStatus.textContent = "Documento subido correctamente (con vista previa).";
      uploadStatus.style.color = "#125048";
      uploadStatus.hidden = false;
      await loadPublications();
    } catch (error) {
      uploadStatus.textContent = error.message || "No se pudo subir el documento";
      uploadStatus.hidden = false;
      uploadStatus.style.color = "#b42318";
    }
  });

  adminList.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const item = target.closest(".admin-item");
    if (!item) return;
    const id = item.getAttribute("data-id");

    if (target.matches("[data-save]")) {
      const title = item.querySelector("[data-edit-title]")?.value || "";
      const description = item.querySelector("[data-edit-description]")?.value || "";
      try {
        const data = await api(`/api/admin/publications/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, description, csrf }),
        });
        setCsrf(data.csrf);
        await loadPublications();
      } catch (error) {
        alert(error.message || "No se pudo guardar");
      }
    }

    if (target.matches("[data-delete]")) {
      pendingDeleteId = id;
      const title = item.querySelector("h3")?.textContent || "esta publicación";
      confirmText.textContent = `¿Seguro que desea eliminar “${title}”? Esta acción no se puede deshacer.`;
      confirmModal.hidden = false;
    }
  });

  confirmCancel.addEventListener("click", () => {
    pendingDeleteId = null;
    confirmModal.hidden = true;
  });

  confirmDelete.addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    try {
      const data = await api(`/api/admin/publications/${encodeURIComponent(pendingDeleteId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csrf }),
      });
      setCsrf(data.csrf);
      pendingDeleteId = null;
      confirmModal.hidden = true;
      await loadPublications();
    } catch (error) {
      alert(error.message || "No se pudo eliminar");
    }
  });

  bootstrap();
})();
