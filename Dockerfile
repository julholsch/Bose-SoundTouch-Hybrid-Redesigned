FROM node:22-slim
WORKDIR /app

# Install tzdata using Debian's package manager (apt-get)
RUN apt-get update && apt-get install -y tzdata && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy all code/templates into the image
COPY . .

# Create the internal config directory
RUN mkdir -p /app/config && chown -R node:node /app

# NOTE: We intentionally run as root here so the container 
# maintains permission to access /var/run/docker.sock

CMD ["node", "server.js"]