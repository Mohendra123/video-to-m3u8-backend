FROM node:18-bullseye-slim

# FFmpeg इंस्टॉल करें
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Dependencies इंस्टॉल करें
COPY package*.json ./
RUN npm install

# कोड कॉपी करें
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
