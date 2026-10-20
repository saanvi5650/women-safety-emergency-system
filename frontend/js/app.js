// Local development talks to the backend on port 5000; on Vercel the API is on the same domain
const API_URL = ["localhost", "127.0.0.1", ""].includes(window.location.hostname)
  ? "http://localhost:5000"
  : "";

const $ = (s) => document.querySelector(s);

function showToast(msg) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function updateStrength(val) {
  const bars = ['#sb1', '#sb2', '#sb3', '#sb4'].map(id => $(id)).filter(Boolean);
  let score = 0;

  if (val.length >= 6) score++;
  if (val.length >= 10) score++;
  if (/[A-Z]/.test(val) && /[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  bars.forEach((bar, i) => {
    bar.className = '';
    if (i < score) {
      if (score <= 1) bar.classList.add('active');
      else if (score <= 2) bar.classList.add('medium');
      else bar.classList.add('strong');
    }
  });
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('show');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}
function requireLogin() {
  const user = localStorage.getItem("user");
  if (!user) {
    window.location.href = "login.html";
  }
}
document.addEventListener("DOMContentLoaded", () => {
  if (window.location.pathname.includes("dashboard.html")) {
    requireLogin();
    loadDashboardUser();
  }

  if (window.location.pathname.includes("contacts.html")) {
    requireLogin();
    loadContacts();
  }
});

let countdownTimer = null;

function triggerSOS() {
  const overlay = $('#alertOverlay');
  const counter = $('#countNum');

  if (!overlay || !counter) return;

  overlay.classList.add('show');
  let count = 10;
  counter.textContent = count;

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => console.log('Location:', pos.coords.latitude, pos.coords.longitude),
      err => console.log('Geo error', err.message)
    );
  }

  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    count -= 1;
    counter.textContent = count;

    if (count <= 0) {
      clearInterval(countdownTimer);
      overlay.classList.remove('show');
      showToast('Emergency alert escalated to all contact layers');
    }
  }, 1000);
}

function cancelAlert() {
  clearInterval(countdownTimer);
  const overlay = $('#alertOverlay');
  if (overlay) overlay.classList.remove('show');
  showToast('Alert cancelled successfully');
}

async function handleSignup(event) {
  event.preventDefault();
  console.log("Signup function triggered");

  const firstName = document.getElementById("firstName")?.value.trim();
  const lastName = document.getElementById("lastName")?.value.trim();
  const email = document.getElementById("email")?.value.trim();
  const phone = document.getElementById("phone")?.value.trim();
  const password = document.getElementById("signup-pass")?.value.trim();

  if (!firstName || !lastName || !email || !phone || !password) {
    alert("Please fill all required fields");
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/auth/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        phone,
        password
      })
    });

    const data = await response.json();
    console.log("Signup response:", data);

    if (response.ok) {
      showToast("Account created successfully!");
      setTimeout(() => {
        window.location.href = "login.html";
      }, 1000);
    } else {
      alert(data.message || "Signup failed");
    }
  } catch (error) {
    console.error("Signup error:", error);
    alert("Server error during signup");
  }
}
async function addContact(event) {
  event.preventDefault();

  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) {
    alert("Please login first");
    return;
  }

  const name = document.getElementById("contactName")?.value.trim();
  const relationship = document.getElementById("contactRelationship")?.value;
  const phone = document.getElementById("contactPhone")?.value.trim();
  const email = document.getElementById("contactEmail")?.value.trim();
  const priority = parseInt(document.getElementById("contactPriority")?.value);

  if (!name || !relationship || !phone || !priority) {
    alert("Please fill all required contact details");
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/contacts/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userId: user.id,
        name,
        relationship,
        phone,
        email,
        priority
      })
    });

    const data = await response.json();
    console.log("Add contact response:", data);

    if (response.ok) {
      showToast("Contact added successfully!");
      closeModal("addContactModal");
      loadContacts();
    } else {
      alert(data.message || "Failed to add contact");
    }
  } catch (error) {
    console.error("Add contact error:", error);
    alert("Server error while adding contact");
  }
}

async function loadContacts() {
  const user = JSON.parse(localStorage.getItem("user"));
  const container = document.getElementById("contactsContainer");

  if (!user || !container) return;

  try {
    const response = await fetch(`${API_URL}/api/contacts/${user.id}`);
    const contacts = await response.json();

    container.innerHTML = "";

    contacts.forEach(contact => {
      container.innerHTML += `
        <article class="card contact-card">
          <div class="contact-row" style="padding-top:0">
            <div class="contact-avatar priority-${contact.priority}">
              ${contact.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <strong>${contact.name}</strong>
              <div style="color:var(--text-muted)">
                ${contact.relationship} · Priority ${contact.priority}
              </div>
            </div>
          </div>
          <div class="contact-meta">
            <div>📱 ${contact.phone}</div>
            <div>✉️ ${contact.email || "No email"}</div>
          </div>
          <div class="contact-actions">
            <button class="btn btn-outline">Edit</button>
            <button class="btn btn-primary">Call</button>
          </div>
        </article>
      `;
    });

  } catch (error) {
    console.error("Load contacts error:", error);
  }
}

function loadDashboardUser() {
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user) return;

  const fullName = `${user.firstName} ${user.lastName}`;

  const sidebarUserName = document.getElementById("sidebarUserName");
  const sidebarUserEmail = document.getElementById("sidebarUserEmail");
  const welcomeUser = document.getElementById("welcomeUser");

  if (sidebarUserName) sidebarUserName.textContent = fullName;
  if (sidebarUserEmail) sidebarUserEmail.textContent = user.email;
  if (welcomeUser) welcomeUser.textContent = `Good Evening, ${user.firstName} 👋`;
}

async function loadDashboardContacts() {
  const user = JSON.parse(localStorage.getItem("user"));
  const container = document.getElementById("dashboardContactsContainer");

  if (!user || !container) return;

  try {
    const response = await fetch(`${API_URL}/api/contacts/${user.id}`);
    const contacts = await response.json();

    container.innerHTML = "";

    if (!contacts.length) {
      container.innerHTML = `<p style="color: var(--text-muted);">No trusted contacts added yet.</p>`;
      return;
    }

    contacts.forEach(contact => {
      container.innerHTML += `
        <div class="contact-row">
          <div class="contact-avatar priority-${contact.priority}">
            ${contact.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <strong>${contact.name}</strong>
            <div style="color:var(--text-muted)">
              ${contact.relationship} · ${contact.phone}
            </div>
          </div>
          <span class="priority-chip">Priority ${contact.priority}</span>
        </div>
      `;
    });

  } catch (error) {
    console.error("Dashboard contacts error:", error);
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const emailOrPhone = document.getElementById("loginEmailOrPhone")?.value.trim();
  const password = document.getElementById("loginPassword")?.value.trim();

  if (!emailOrPhone || !password) {
    alert("Please fill all fields");
    return;
  }

  try {
    const response = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ emailOrPhone, password })
    });

    const data = await response.json();
    console.log("Login response:", data);

    if (response.ok) {
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      showToast("Login successful!");
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 800);
    } else {
      alert(data.message || "Login failed");
    }
  } catch (error) {
    console.error("Login error:", error);
    alert("Server error during login");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.location.pathname.includes("dashboard.html")) {
    requireLogin();
    loadDashboardUser();
    loadDashboardContacts();
  }

  if (window.location.pathname.includes("contacts.html")) {
    requireLogin();
    loadDashboardUser();
    loadContacts();
  }
});