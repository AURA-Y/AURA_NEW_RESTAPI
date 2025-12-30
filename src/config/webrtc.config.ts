export const webrtcConfig = {
  // STUN/TURN servers
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302',
    },
    // TURN 서버 설정 (필요 시 추가)
    // {
    //   urls: 'turn:your-turn-server.com:3478',
    //   username: 'username',
    //   credential: 'password',
    // },
  ],

  // ICE transport policy
  iceTransportPolicy: 'all', // 'all' | 'relay'

  // Bundle policy
  bundlePolicy: 'max-bundle', // 'balanced' | 'max-compat' | 'max-bundle'

  // RTCP mux policy
  rtcpMuxPolicy: 'require', // 'negotiate' | 'require'
};
