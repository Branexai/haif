FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . ./
# Vite dev server on 0.0.0.0:5173
EXPOSE 5173
CMD ["npm","run","dev","--","--host","0.0.0.0","--port","5173"]