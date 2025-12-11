// frontend/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// ✅ CSS global – agora no diretório styles
import "./styles/App.css";     // se você quer usar só o App.css
// ou, se tiver um index.css global, pode ficar:
// import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
