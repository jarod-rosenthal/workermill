export const config = {
  appName: process.env.APP_NAME || "{{PROJECT_NAME}}",
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
};
