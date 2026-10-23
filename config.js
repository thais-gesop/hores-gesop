// ---------------------------------------------------------------------------
// CONFIGURACIÓ — omple aquests dos valors amb els del teu projecte de Supabase
// (Supabase > Project Settings > API):
//   SUPABASE_URL      -> "Project URL"
//   SUPABASE_ANON_KEY -> clau "anon" / "public"  (és pública per disseny: la seguretat
//                        la donen les regles de la base de dades, no aquesta clau)
// ---------------------------------------------------------------------------
window.HORES_CONFIG = {
  SUPABASE_URL: "https://vuommeklygdrulgvyhni.supabase.co/rest/v1/",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1b21tZWtseWdkcnVsZ3Z5aG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NTg0NzMsImV4cCI6MjEwODMzNDQ3M30.Ei6zTd0eoomCIbP0atZ0kLx1O3steAj50codSZJYe0k",

  // Els usuaris entren amb un nom curt (p. ex. "rocio"); internament es converteix
  // en rocio@<DOMINI>. No s'hi envia cap correu. No ho canviïs un cop creats els usuaris.
  DOMINI: "hores.gesop.net",

  TITOL: "Registre d'hores · GESOP",

  // Límit setmanal: el comptador de la setmana es posa taronja a partir d'AVIS_H i vermell si se supera LIMIT_SETMANA_H
  LIMIT_SETMANA_H: 40,
  AVIS_H: 36,

  // Logo blanc de GESOP (el mateix que fan servir les apps Shiny). Si preferiu no dependre
  // de la web de GESOP, deseu el logo com a logo.png dins d'aquesta carpeta i poseu "logo.png".
  LOGO_URL: "https://gesop.net/wp-content/uploads/2025/12/LogoGesop_White.png"
};
