window.APP_CONFIG = {
  title: "Visor Territorial de Trámites - Riobamba",
  subtitle: "Distribución espacial, estado y tiempos de atención de trámites municipales",
  initialView: [-1.6735, -78.6483],
  initialZoom: 12,
  basemap: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors"
  },
  fields: {
    id: "gid",
    transactionNumber: "num_trami",
    transactionNumberAlt: "TRÁMITE_e",
    type: "tramite_ge",
    status: "ESTADO_DE_",
    entryDate: "FECHA_DE_R",
    dispatchDate: "FECHA_DESP",
    duration: "duracion_g",
    dateQuality: "",
    platform: "plataforma",
    parish: "parroquia",
    cadastralKey: "claves",
    office: "JEFATURA_A",
    technician: "TECNICO_RE"
  },
  typeColors: {
    "CERTIFICADO DE JURISDICCIÓN": "#7B2CBF",
    "TRANSFERENCIA DE DOMINIO": "#D62828",
    "IPRUS": "#0077B6",
    "ACTUALIZACIÓN CATASTRAL": "#2A9D8F",
    "INGRESO AL CATASTRO": "#3A86FF",
    "EXCEDENTES Y DIFERENCIAS": "#F77F00",
    "LOTE MÍNIMO MIDUVI": "#6A994E",
    "CAMBIO DE DOMINIO": "#E76F51",
    "IRM": "#457B9D",
    "PETICIONES VARIAS": "#8D99AE",
    "REAVALUO / CERTIFICADO DE AVALÚO": "#BC6C25",
    "PETICIONES VARIAS TOPOGRAFÍA": "#8338EC",
    "BAJA / REFACTURACIÓN": "#FF006E",
    "CEM": "#FFBE0B",
    "OTRO": "#6C757D"
  },
  fallbackTypeColors: [
    "#5A2D82", "#A32F67", "#C84B71", "#EF9F1A", "#35A9B7", "#6B4F9B",
    "#2A9D8F", "#BC6C25", "#457B9D", "#8338EC", "#6A994E", "#E76F51"
  ],
  statusColors: {
    "FINALIZADO": "#2A9D8F",
    "EN PROCESO": "#F4A261",
    "SIN DATO": "#9CA3AF"
  },
 layers: [
  {id:"parroquias", name:"Parroquias", role:"parishes", type:"geojson", url:"data/parroquias_reales.geojson", visible:true,
    style:{color:"#6B4F9B",weight:2,fillColor:"#B9A7D5",fillOpacity:0.045}},
  {id:"plataformas", name:"Plataformas territoriales", role:"platforms", type:"geojson", url:"data/plataformas_reales.geojson", visible:true,
    style:{color:"#C03A67",weight:2,fillColor:"#E8A5BC",fillOpacity:0.055}},
  {id:"tramites", name:"Trámites", role:"procedures", type:"geojson", url:"data/tramites_actualizados.geojson", visible:true}
]
};
