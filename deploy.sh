set -e
echo "Building image..."
docker build --no-cache -t sagarhydra/pos:latest .

echo "Pushing to registry..."
docker login -u sagarhydra -p dckr_pat_QyHSJKUS6O-g_Dl0eWfviGZpA9k

docker push sagarhydra/pos:latest

echo "Build & Push completed!"