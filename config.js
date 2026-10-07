// change stuff here, not in app.js
const CONFIG = {
  DATABASE_URL: "https://bloods-turf-track-default-rtdb.europe-west1.firebasedatabase.app/",

  MAP_IMAGE: "map.jpg",
  MAP_SIZE: 554,          // map is 554 x 554
  MAX_LOYALTY: 10000,
  DECAY_PER_DAY: 2500,    // how much loyalty we lose per day if nobody touches the turf. adjust to match the server!
  TASKS: ["Spray", "Sell drugs"],
  REFRESH_SECONDS: 15
};
