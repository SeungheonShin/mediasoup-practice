import express from "express";
import https from "httpolyglot";
import mediasoup from "mediasoup";
import path from "path";
import { Server } from "socket.io";

const __dirname = path.resolve();
const app = express();

app.get("/", (req, res) => {
  res.send("hello");
});

app.use("/sfu", express.static(path.join(__dirname, "public")));

const config = {};
const httpsServer = https.createServer(config, app);

httpsServer.listen(3000, () => {
  console.log("listening on 3000");
});

const io = new Server(httpsServer);
const peers = io.of("/mediasoup");

let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log("worker pid :", worker.pid);

  worker.on("died", (err) => {
    console.log("mediasoup worker died. :", err);
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
};

peers.on("connection", async (socket) => {
  console.log(socket.id);
  socket.emit("connection-success", { socketId: socket.id });
  socket.on("disconnect", () => {
    console.log("peer disconnected:", socket.id);
  });

  router = await worker.createRouter({ mediaCodecs });

  socket.on("getRtpCapabilities", (cb) => {
    const rtpCapabilities = router.rtpCapabilities;
    console.log("getRtpCapabilities:", rtpCapabilities);

    cb({ rtpCapabilities });
  });

  socket.on("createWebRtcTransport", async ({ sender }, cb) => {
    if (sender) {
      producerTransport = await createWebRtcTransport(cb);
    } else {
      consumerTransport = await createWebRtcTransport(cb);
    }
  });

  socket.on("transport-connect", async ({ dtlsParameters }) => {
    console.log("dtls parameters:", dtlsParameters);
    await producerTransport.connect({ dtlsParameters });
  });

  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, appData }, cb) => {
      producer = await producerTransport.produce({
        kind,
        rtpParameters,
      });

      console.log("producer id:", producer.id);

      producer.on("transportclose", () => {
        console.log("transport closed.");
        producer.close();
      });

      cb({ id: producer.id });
    }
  );

  socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
    console.log("dtls params:", dtlsParameters);
    await consumerTransport.connect({ dtlsParameters });
  });

  socket.on("consume", async ({ rtpCapabilities }, cb) => {
    try {
      if (
        router.canConsume({
          producerId: producer.id,
          rtpCapabilities,
        })
      ) {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        consumer.on("transportclose", () => {
          console.log("transport closed");
        });

        consumer.on("produerclose", () => {
          console.log("producer closed");
        });

        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };

        cb({ params });
      }
    } catch (err) {
      console.log(err);
      cb({
        params: {
          error: err,
        },
      });
    }
  });

  socket.on("consumer-resume", async () => {
    await consumer.resume();
  });
});

const createWebRtcTransport = async (cb) => {
  try {
    const webRtcTransportOptions = {
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: "127.0.0.1",
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    let transport = await router.createWebRtcTransport(webRtcTransportOptions);
    console.log("transport id:", transport.id);

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") {
        transport.close();
      }
    });

    transport.on("close", () => {
      console.log("transport closed:", transport.id);
    });

    cb({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });

    return transport;
  } catch (err) {
    console.log(err);
    cb({
      params: {
        error: err,
      },
    });
  }
};

worker = createWorker();
