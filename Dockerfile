FROM node:17-alpine3.14
WORKDIR /app
ADD package.json ./
ADD package-lock.json ./
RUN npm i
ADD index.js ./
CMD ["index.js"]