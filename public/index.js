const io = require("socket.io-client");
const mediasoupClient = require("mediasoup-client");
const socket = io("/mediasoup");

socket.on("connection-success", ({ socketId, existsProducer }) => {
  console.log(socketId, existsProducer);
});

let params = {
  encoding: [
    {
      rid: "r0",
      maxBitrate: 100000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r1",
      maxBitrate: 300000,
      scalabilityMode: "S1T3",
    },
    {
      rid: "r2",
      maxBitrate: 900000,
      scalabilityMode: "S1T3",
    },
  ],
  codecOptions: {
    videoGoogleStartBitrate: 1000,
  },
};
let device;
let rtpCapabilities;
let producerTransport;
let consumerTransport;
let producer;
let consumer;
let isProducer = false;

const streamSuccess = (stream) => {
  console.log("stream:", stream);
  const localVideo = document.getElementById("localVideo");
  const track = stream.getVideoTracks()[0];

  localVideo.srcObject = stream;

  params = {
    track,
    ...params,
  };
  console.log("params:", params);

  goConnect(true);
};

const getLocalStream = () => {
  navigator.mediaDevices
    .getUserMedia({
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        },
      },
    })
    .then(streamSuccess)
    .catch((err) => console.log(err));
};

const goConsume = () => {
  goConnect(false);
};

const goConnect = (producerConsumer) => {
  isProducer = producerConsumer;
  device === undefined ? getRtpCapabilities() : goCreateTransport();
};

const goCreateTransport = () => {
  isProducer ? createSendTransport() : createRecvTransport();
};

const createDevice = async () => {
  try {
    device = new mediasoupClient.Device();
    await device.load({
      routerRtpCapabilities: rtpCapabilities,
    });

    console.log("device rtp capabilities:", device.rtpCapabilities);

    goCreateTransport();
  } catch (err) {
    console.log(err);
  }
};

const getRtpCapabilities = () => {
  socket.emit("createRoom", (data) => {
    console.log("Router rtp capabilities:", data.rtpCapabilities);

    rtpCapabilities = data.rtpCapabilities;

    createDevice();
  });
};

const createSendTransport = () => {
  socket.emit("createWebRtcTransport", { sender: true }, ({ params }) => {
    if (params.error) {
      console.log(params.error);
      return;
    }

    console.log("params:", params);

    producerTransport = device.createSendTransport(params);
    producerTransport.on("connect", async ({ dtlsParameters }, cb, errcb) => {
      try {
        await socket.emit("transport-connect", { dtlsParameters });

        cb();
      } catch (err) {
        errcb(err);
      }
    });

    producerTransport.on("produce", async (params, cb, errcb) => {
      console.log("params:", params);

      try {
        await socket.emit(
          "transport-produce",
          {
            kind: params.kind,
            rtpParameters: params.rtpParameters,
            appData: params.appData,
          },
          ({ id }) => {
            cb({ id });
          }
        );
      } catch (err) {
        errcb(err);
      }
    });

    connectSendTransport();
  });
};

const connectSendTransport = async () => {
  producer = await producerTransport.produce(params);

  producer.on("trackended", () => {
    console.log("track ended");
  });

  producer.on("transportclose", () => {
    console.log("transport closed");
  });
};

const createRecvTransport = async () => {
  await socket.emit(
    "createWebRtcTransport",
    { sender: false },
    ({ params }) => {
      if (params.error) {
        console.log(params.error);
        return;
      }
      console.log("params:", params);

      consumerTransport = device.createRecvTransport(params);
      consumerTransport.on("connect", async ({ dtlsParameters }, cb, errcb) => {
        try {
          await socket.emit("transport-recv-connect", { dtlsParameters });

          cb();
        } catch (err) {
          errcb(err);
        }
      });
      connectRecvTransport();
    }
  );
};

const connectRecvTransport = async () => {
  await socket.emit(
    "consume",
    { rtpCapabilities: device.rtpCapabilities },
    async ({ params }) => {
      if (params.error) {
        console.log(params.error);
        return;
      }

      console.log("recv params:", params);
      const { id, producerId, kind, rtpParameters } = params;

      consumer = await consumerTransport.consume({
        id,
        producerId,
        kind,
        rtpParameters,
      });

      const { track } = consumer;
      console.log("track:", track);
      const remoteVideo = document.getElementById("remoteVideo");
      console.log(remoteVideo);
      remoteVideo.srcObject = new MediaStream([track]);
      socket.emit("consumer-resume");
    }
  );
};

const btnLocalVideo = document.getElementById("btnLocalVideo");
const btnRecvSendTransport = document.getElementById("btnRecvSendTransport");

btnLocalVideo.addEventListener("click", getLocalStream);
btnRecvSendTransport.addEventListener("click", goConsume);
